import { getAllStockMasterAsStockEquity } from './src/services/stockMasterStore';
import {
  getMasterStockCagr,
  getAllMasterStockCagr,
  getMasterCagrStocksCount,
  updateMasterStockCagr,
  importMasterCagrJson,
  subscribeMasterCagrStore,
} from './src/services/masterCagrStore';
import {
  buildStockCagrDataset,
  clearStockCagrCache,
} from './src/engine/quantitativeMath';
import {
  HISTORICAL_NIFTY_CORRECTION_EVENTS,
  PRECOMPUTED_CORRECTION_RESPONSES,
  generateCorrectionResponses,
} from './src/services/historicalData';
import { StockEquity } from './src/types/equity';
import rawMasterData from './src/data/master_stock_cagr.json';

console.log('====================================================');
console.log('STARTING INDEPENDENT POST-FIX COMPREHENSIVE AUDIT');
console.log('====================================================');

let totalPassed = 0;
let totalFailed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    totalPassed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    totalFailed++;
  }
}

// ----------------------------------------------------
// AUDIT SECTION 1: MASTER CAGR EQUITIES RESOLUTION (1,131 EQUITIES)
// ----------------------------------------------------
console.log('\n--- SECTION 1: Master CAGR Universe Coverage & Integrity ---');
const totalMasterEntries = getMasterCagrStocksCount();
assert(totalMasterEntries >= 1130, `Master CAGR store loaded ${totalMasterEntries} entries (expected >= 1130)`);

// Check canonical stocks
const testSymbols = ['RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK', 'ITC', 'SBIN'];
testSymbols.forEach((sym) => {
  const cagrRecord = getMasterStockCagr(sym);
  assert(cagrRecord !== null, `Master CAGR record found for ${sym}`);
  assert(cagrRecord?.symbol === sym, `Canonical symbol preserved for ${sym}`);
  assert(typeof cagrRecord?.cagr1Y === 'number' || cagrRecord?.cagr1Y === null, `${sym} has valid cagr1Y`);
});

// Check all 1,131 equities in rawMasterData resolve
let resolvedCount = 0;
let validCagrCount = 0;
for (const [sym, expected] of Object.entries(rawMasterData)) {
  const rec = getMasterStockCagr(sym);
  if (rec) {
    resolvedCount++;
    if (rec.cagr1Y !== undefined && rec.cagr5Y !== undefined) {
      validCagrCount++;
    }
  }
}
assert(resolvedCount === Object.keys(rawMasterData).length, `All ${resolvedCount}/${Object.keys(rawMasterData).length} raw master records resolved via getMasterStockCagr`);
assert(validCagrCount === resolvedCount, `All ${validCagrCount} resolved records have valid CAGR properties`);

// ----------------------------------------------------
// AUDIT SECTION 2: EDGE CASES (MISSING, MALFORMED, INCOMPLETE RECORDS)
// ----------------------------------------------------
console.log('\n--- SECTION 2: Edge Cases (Missing, Malformed, Incomplete) ---');

// 2.1 Non-existent symbol
const missingRecord = getMasterStockCagr('NON_EXISTENT_TICKER_12345');
assert(missingRecord === null, 'Non-existent symbol returns null (safe fallback)');

// Test buildStockCagrDataset with missing symbol (no bars, not in master)
const unknownStock: StockEquity = {
  symbol: 'NON_EXISTENT_TICKER_12345',
  companyName: 'Ghost Stock Ltd',
  sector: 'Technology',
  industry: 'Software',
  capTier: 'MID',
  marketCapRank: 9999,
  currentPrice: 100,
  historicalBarsCount: 0,
};
const unknownResult = buildStockCagrDataset([unknownStock]);
assert(unknownResult.length === 1, 'buildStockCagrDataset handled unknown stock without throwing');
assert(unknownResult[0].cagr1Y === null, 'Unknown stock has null CAGR (no fabricated values)');
assert(unknownResult[0].dataProvenance === 'INSUFFICIENT_HISTORY', 'Unknown stock marked INSUFFICIENT_HISTORY');

// 2.2 Malformed symbols (spaces, casing, .NS / .BO extensions, NSE: prefix)
assert(getMasterStockCagr(' reliance ')?.symbol === 'RELIANCE', 'Handles trailing whitespace and lowercase');
assert(getMasterStockCagr('TCS.NS')?.symbol === 'TCS', 'Handles .NS suffix');
assert(getMasterStockCagr('INFY.BO')?.symbol === 'INFY', 'Handles .BO suffix');
assert(getMasterStockCagr('NSE:HDFCBANK')?.symbol === 'HDFCBANK', 'Handles NSE: prefix');
assert(getMasterStockCagr('') === null, 'Empty symbol returns null safely');

// 2.3 Incomplete / partial records
const partialStock: StockEquity = {
  symbol: 'PARTIAL_TEST',
  companyName: '',
  sector: '',
  industry: '',
  capTier: 'LOW',
  marketCapRank: 0,
  currentPrice: 0,
};
const partialResult = buildStockCagrDataset([partialStock]);
assert(partialResult.length === 1, 'Handles partial equity without crash');
assert(partialResult[0].symbol === 'PARTIAL_TEST', 'Preserves symbol on partial equity');

// ----------------------------------------------------
// AUDIT SECTION 3: LAZY CORRECTION RESPONSES VERIFICATION
// ----------------------------------------------------
console.log('\n--- SECTION 3: Lazy Correction Responses & Fall Module Verification ---');

// In unrelated tabs, activeCorrectionResponses returns PRECOMPUTED_CORRECTION_RESPONSES immediately
const precomputed = PRECOMPUTED_CORRECTION_RESPONSES;
assert(Array.isArray(precomputed) && precomputed.length > 0, `PRECOMPUTED_CORRECTION_RESPONSES available (${precomputed.length} entries)`);

// When on crisis tab with stocks having historical bars
const dummyStocksWithBars: StockEquity[] = [
  {
    symbol: 'RELIANCE',
    companyName: 'Reliance Industries Ltd',
    sector: 'Energy',
    industry: 'Oil',
    capTier: 'HIGH',
    marketCapRank: 1,
    currentPrice: 2500,
    historicalBarsCount: 500,
  },
];
const generated = generateCorrectionResponses(dummyStocksWithBars, HISTORICAL_NIFTY_CORRECTION_EVENTS);
assert(Array.isArray(generated), 'generateCorrectionResponses produces valid array when called on-demand');
assert(generated.length > 0, `Generated correction responses count: ${generated.length}`);
assert(generated[0].symbol === 'RELIANCE', 'Generated response matches input stock symbol');
assert(typeof generated[0].maxDrawdownPct === 'number', 'Drawdown calculation is valid deterministic number');

// ----------------------------------------------------
// AUDIT SECTION 4: MASTER CAGR UPDATES & LISTENER PROPAGATION
// ----------------------------------------------------
console.log('\n--- SECTION 4: Listener Subscriptions & Update Propagation ---');

let listenerFiredCount = 0;
const testListener = () => {
  listenerFiredCount++;
};

// Subscribe
const unsubscribe = subscribeMasterCagrStore(testListener);

// Update single stock
const updateSuccess = updateMasterStockCagr('RELIANCE', { cagr1Y: 99.9 });
assert(updateSuccess === true, 'updateMasterStockCagr returned true');
assert(listenerFiredCount === 1, `Listener fired exactly 1 time on single update (count: ${listenerFiredCount})`);

// Verify getMasterStockCagr reflects the update
const updatedReliance = getMasterStockCagr('RELIANCE');
assert(updatedReliance?.cagr1Y === 99.9, 'Updated value is reflected in getMasterStockCagr');

// Test unsubscription (prevent memory leak)
unsubscribe();
updateMasterStockCagr('RELIANCE', { cagr1Y: 22.94 }); // reset
assert(listenerFiredCount === 1, 'Listener did NOT fire after unsubscription (no listener leak)');

// Verify reset
const resetReliance = getMasterStockCagr('RELIANCE');
assert(resetReliance?.cagr1Y === 22.94, 'Reliance cagr1Y successfully reset to canonical value');

// ----------------------------------------------------
// AUDIT SECTION 5: EXTERNAL MASTER JSON UPDATES WHEN STORE IS ALREADY POPULATED
// ----------------------------------------------------
console.log('\n--- SECTION 5: External Master JSON Update on Populated Store ---');

const initialCount = getMasterCagrStocksCount();
assert(initialCount >= 1130, `In-memory store is currently populated with ${initialCount} stocks`);

// Prepare external JSON update simulating an external file with updated & new stock records
const externalJsonPayload = JSON.stringify({
  RELIANCE: {
    symbol: 'RELIANCE',
    companyName: 'Reliance Industries Limited (External Update)',
    sector: 'Energy minerals',
    industry: 'Oil refining/Marketing',
    capTier: 'HIGH',
    cagr1Y: 35.5,
    cagr3Y: 18.2,
    cagr5Y: 21.0,
    cagr10Y: 17.5,
    cagr13Y: 23.1,
  },
  NEW_EQUITY_2026: {
    symbol: 'NEW_EQUITY_2026',
    companyName: 'New Indian Equity Tech Ltd',
    sector: 'Technology',
    industry: 'Software',
    capTier: 'MID',
    cagr1Y: 42.0,
    cagr3Y: 25.0,
    cagr5Y: null,
    cagr10Y: null,
    cagr13Y: null,
  },
});

const importTracker = { fired: false };
const unsubImportListener = subscribeMasterCagrStore(() => {
  importTracker.fired = true;
});

const importResult = importMasterCagrJson(externalJsonPayload);
assert(importResult.success === true, 'importMasterCagrJson succeeds when store is already populated');
assert(importResult.count === 2, `importMasterCagrJson imported ${importResult.count} records (expected 2)`);
assert(importTracker.fired, 'importMasterCagrJson notified subscribers of external JSON update');

// Verify updated values in store
const updatedStock = getMasterStockCagr('RELIANCE');
assert(
  updatedStock?.companyName === 'Reliance Industries Limited (External Update)',
  'Existing stock was updated in-memory from external JSON'
);
assert(updatedStock?.cagr1Y === 35.5, 'Existing stock CAGR was updated from external JSON');

const newStock = getMasterStockCagr('NEW_EQUITY_2026');
assert(newStock !== null, 'New stock from external JSON was added to store');
assert(newStock?.cagr1Y === 42.0, 'New stock CAGR is accessible from store');

// Clean up: restore canonical Reliance
updateMasterStockCagr('RELIANCE', {
  companyName: rawMasterData.RELIANCE.companyName,
  cagr1Y: rawMasterData.RELIANCE.cagr1Y,
  cagr3Y: rawMasterData.RELIANCE.cagr3Y,
  cagr5Y: rawMasterData.RELIANCE.cagr5Y,
  cagr10Y: rawMasterData.RELIANCE.cagr10Y,
  cagr13Y: rawMasterData.RELIANCE.cagr13Y,
});
unsubImportListener();

// ----------------------------------------------------
// AUDIT SECTION 6: MEMORY & RENDER CYCLE SIMULATION
// ----------------------------------------------------
console.log('\n--- SECTION 6: Memory & Render Performance Simulation ---');

const memBefore = process.memoryUsage().heapUsed / (1024 * 1024);
console.log(`  Initial Heap Used: ${memBefore.toFixed(2)} MB`);

// Simulate rapid switching between modules
const mockUniverseStocks = Object.keys(rawMasterData).slice(0, 500).map((sym, idx) => ({
  symbol: sym,
  companyName: (rawMasterData as any)[sym].companyName || sym,
  sector: (rawMasterData as any)[sym].sector || 'General',
  industry: (rawMasterData as any)[sym].industry || 'General',
  capTier: (rawMasterData as any)[sym].capTier || 'MID',
  marketCapRank: idx + 1,
  currentPrice: 500,
  historicalBarsCount: 0,
}));

// Run 20 mock render cycles of buildStockCagrDataset
for (let i = 0; i < 20; i++) {
  const result = buildStockCagrDataset(mockUniverseStocks);
  assert(result.length === 500, `Render cycle ${i + 1}: returned 500 records`);
}

const memAfter = process.memoryUsage().heapUsed / (1024 * 1024);
console.log(`  Heap Used After 20 Dataset Cycles: ${memAfter.toFixed(2)} MB (Delta: ${(memAfter - memBefore).toFixed(2)} MB)`);
assert(memAfter - memBefore < 80, `Memory delta is bounded (<80MB, actual: ${(memAfter - memBefore).toFixed(2)} MB)`);

// ----------------------------------------------------
// AUDIT SUMMARY
// ----------------------------------------------------
console.log('\n====================================================');
console.log(`AUDIT RESULTS: ${totalPassed} PASSED, ${totalFailed} FAILED`);
console.log('====================================================');

if (totalFailed > 0) {
  process.exit(1);
}
