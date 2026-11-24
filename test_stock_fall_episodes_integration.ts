import fs from 'fs';
import {
  loadStockFallsFromBuffer,
  getAllStockFallSummaries,
  getStockFallSummary,
  getStockFallEpisodes,
  getStockFallMetadata,
} from './src/services/stockFallEpisodesStore';
import { loadMasterDataFromParquetBuffer, getAllStockMasterAsStockEquity } from './src/services/stockMasterStore';

async function runTestSuite() {
  console.log('====================================================');
  console.log('STOCK FALL EPISODES & RECONCILIATION TEST SUITE');
  console.log('====================================================');
  let passCount = 0;
  let failCount = 0;

  function assert(condition: boolean, msg: string) {
    if (condition) {
      console.log(`  ✓ PASS: ${msg}`);
      passCount++;
    } else {
      console.error(`  ✗ FAIL: ${msg}`);
      failCount++;
    }
  }

  // 1. Authoritative Master Parquet Ingestion
  console.log('\n--- 1. Authoritative Master Universe (1,131 stocks) ---');
  const masterBuf = fs.readFileSync('All_equity_details.parquet');
  const masterArrayBuf = masterBuf.buffer.slice(masterBuf.byteOffset, masterBuf.byteOffset + masterBuf.byteLength);
  const masterLoadRes = await loadMasterDataFromParquetBuffer(masterArrayBuf, 'All_equity_details.parquet');
  assert(masterLoadRes.success, 'Loaded All_equity_details.parquet successfully');
  const masterStocks = getAllStockMasterAsStockEquity();
  assert(masterStocks.length === 1131, `Authoritative universe count is 1131 (actual: ${masterStocks.length})`);

  // 2. Stock Fall Episodes Parquet Ingestion
  console.log('\n--- 2. Stock Fall Episodes Parquet Ingestion (32,166 records) ---');
  const fallsBuf = fs.readFileSync('ALL_STOCKS_DAILY_WEEKLY_FALLS.parquet');
  const fallsArrayBuf = fallsBuf.buffer.slice(fallsBuf.byteOffset, fallsBuf.byteOffset + fallsBuf.byteLength);
  const fallsLoadRes = await loadStockFallsFromBuffer(fallsArrayBuf, 'ALL_STOCKS_DAILY_WEEKLY_FALLS.parquet');
  assert(fallsLoadRes.success, 'Loaded ALL_STOCKS_DAILY_WEEKLY_FALLS.parquet successfully');
  assert(fallsLoadRes.recordCount === 32166, `Raw record count is exactly 32,166 (actual: ${fallsLoadRes.recordCount})`);
  assert(fallsLoadRes.symbolCount === 1129, `Unique symbols in parquet is exactly 1,129 (actual: ${fallsLoadRes.symbolCount})`);

  // 3. Universe Reconciliation & PRADPME / ARHAM Status
  console.log('\n--- 3. Reconciliation & PRADPME / ARHAM Status ---');
  const summaries = getAllStockFallSummaries(true, masterStocks);
  assert(summaries.length === 1131, `Reconciled universe count in explorer matches 1,131 (actual: ${summaries.length})`);

  const pradpme = summaries.find((s) => s.symbol === 'PRADPME');
  assert(pradpme !== undefined, 'PRADPME is present in universe summary');
  assert(pradpme?.hasData === false, 'PRADPME hasData is false (unrecorded in parquet)');
  assert(pradpme?.isUnavailable === true, 'PRADPME marked as unavailable');
  assert(pradpme?.totalEpisodes === 0, 'PRADPME has 0 episodes');
  assert(pradpme?.weeklyStats.avgFallPct === null, 'PRADPME weekly avgFallPct is genuine null');
  assert(pradpme?.dailyStats.avgFallPct === null, 'PRADPME daily avgFallPct is genuine null');
  assert(pradpme?.weeklyStats.avgFallPct !== 0, 'PRADPME null is NOT converted to 0');

  const arham = summaries.find((s) => s.symbol === 'ARHAM');
  assert(arham !== undefined, 'ARHAM is present in universe summary');
  assert(arham?.hasData === false, 'ARHAM hasData is false (unrecorded in parquet)');
  assert(arham?.isUnavailable === true, 'ARHAM marked as unavailable');
  assert(arham?.totalEpisodes === 0, 'ARHAM has 0 episodes');
  assert(arham?.weeklyStats.avgFallPct === null, 'ARHAM weekly avgFallPct is genuine null');
  assert(arham?.dailyStats.avgFallPct === null, 'ARHAM daily avgFallPct is genuine null');
  assert(arham?.weeklyStats.avgFallPct !== 0, 'ARHAM null is NOT converted to 0');

  // 4. FALL_PCT Sign Convention Discrepancy Resolution
  console.log('\n--- 4. Sign-Convention Resolution ---');
  const ep20microns = getStockFallEpisodes('20MICRONS');
  const posSample = ep20microns.daily.find((e) => e.rawFallPct > 0);
  assert(posSample !== undefined, 'Found record with positive raw FALL_PCT (20MICRONS)');
  assert((posSample?.rawFallPct ?? 0) > 0, `Preserved raw positive sign: ${posSample?.rawFallPct}`);
  assert(posSample?.normalizedMagnitude === Math.abs(posSample?.rawFallPct ?? 0), `Normalized magnitude is positive: ${posSample?.normalizedMagnitude}`);
  assert(posSample?.displayFallPct === Number((-Math.abs(posSample?.rawFallPct ?? 0)).toFixed(2)), `Standard display percentage is negative: ${posSample?.displayFallPct}%`);

  const epAbb = getStockFallEpisodes('ABB');
  const negSample = epAbb.daily.find((e) => e.rawFallPct < 0);
  assert(negSample !== undefined, 'Found record with negative raw FALL_PCT (ABB)');
  assert((negSample?.rawFallPct ?? 0) < 0, `Preserved raw negative sign: ${negSample?.rawFallPct}`);
  assert(negSample?.normalizedMagnitude === Math.abs(negSample?.rawFallPct ?? 0), `Normalized magnitude is positive: ${negSample?.normalizedMagnitude}`);
  assert(negSample?.displayFallPct === Number((-Math.abs(negSample?.rawFallPct ?? 0)).toFixed(2)), `Standard display percentage is negative: ${negSample?.displayFallPct}%`);

  // 5. Verification of All 8 Core Screener Metrics
  console.log('\n--- 5. Eight Core Metric Columns Verification (RELIANCE) ---');
  const relSummary = getStockFallSummary('RELIANCE', true, masterStocks.find((s) => s.symbol === 'RELIANCE'));
  assert(relSummary !== null, 'RELIANCE summary exists');
  assert(relSummary?.hasData === true, 'RELIANCE hasData is true');
  assert(relSummary?.weeklyStats.count === 6, `Weekly non-COVID episodes count is 6 (actual: ${relSummary?.weeklyStats.count})`);
  assert(relSummary?.weeklyStats.avgFallPct === -22.53, `AVG WEEK %: -22.53% (actual: ${relSummary?.weeklyStats.avgFallPct}%)`);
  assert(relSummary?.weeklyStats.stdDevFallPct === 5.65, `STD DEV (Weekly): 5.65% (actual: ${relSummary?.weeklyStats.stdDevFallPct}%)`);
  assert(relSummary?.weeklyStats.maxFallPct === -30.7, `MAX WEEK %: -30.70% (actual: ${relSummary?.weeklyStats.maxFallPct}%)`);
  assert(relSummary?.weeklyStats.maxPeakDate === '2024-07-08', `MAX WEEK Date: 2024-07-08 (actual: ${relSummary?.weeklyStats.maxPeakDate})`);
  assert(relSummary?.weeklyStats.minFallPct === -15.77, `MIN WEEK %: -15.77% (actual: ${relSummary?.weeklyStats.minFallPct}%)`);
  assert(relSummary?.weeklyStats.minPeakDate === '2023-07-17', `MIN WEEK Date: 2023-07-17 (actual: ${relSummary?.weeklyStats.minPeakDate})`);

  assert(relSummary?.dailyStats.count === 21, `Daily non-COVID episodes count is 21 (actual: ${relSummary?.dailyStats.count})`);
  assert(relSummary?.dailyStats.avgFallPct === -14.13, `AVG DAY %: -14.13% (actual: ${relSummary?.dailyStats.avgFallPct}%)`);
  assert(relSummary?.dailyStats.stdDevFallPct === 4.4, `STD DEV (Daily): 4.40% (actual: ${relSummary?.dailyStats.stdDevFallPct}%)`);
  assert(relSummary?.dailyStats.maxFallPct === -20.94, `MAX DAY %: -20.94% (actual: ${relSummary?.dailyStats.maxFallPct}%)`);
  assert(relSummary?.dailyStats.maxPeakDate === '2024-08-30', `MAX DAY Date: 2024-08-30 (actual: ${relSummary?.dailyStats.maxPeakDate})`);
  assert(relSummary?.dailyStats.minFallPct === -4.03, `MIN DAY %: -4.03% (actual: ${relSummary?.dailyStats.minFallPct}%)`);
  assert(relSummary?.dailyStats.minPeakDate === '2025-11-28', `MIN DAY Date: 2025-11-28 (actual: ${relSummary?.dailyStats.minPeakDate})`);

  // 6. Exclusion of 2020 COVID vs All-time comparison
  console.log('\n--- 6. COVID 2020 Toggle Verification ---');
  const relAllSummary = getStockFallSummary('RELIANCE', false, masterStocks.find((s) => s.symbol === 'RELIANCE'));
  assert(relAllSummary?.weeklyStats.count === 7, `Weekly all episodes count is 7 (actual: ${relAllSummary?.weeklyStats.count})`);
  assert(relAllSummary?.dailyStats.count === 23, `Daily all episodes count is 23 (actual: ${relAllSummary?.dailyStats.count})`);

  console.log('\n====================================================');
  console.log(`TEST SUITE COMPLETE: ${passCount} PASSED, ${failCount} FAILED`);
  console.log('====================================================');

  if (failCount > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
