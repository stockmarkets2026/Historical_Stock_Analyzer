import {
  getMasterStockCagr,
  getAllMasterStockCagr,
  getMasterCagrStocksCount,
} from './src/services/masterCagrStore';
import {
  buildStockCagrDataset,
  calculateSectorCagrDataset,
  calculateIndustryCagrDataset,
} from './src/engine/quantitativeMath';
import { CagrEngine } from './src/engine/cagrEngine';
import { StockEquity } from './src/types/equity';
import rawNewMaster from './src/data/master_stock_cagr.json';

console.log('====================================================');
console.log('MASTER CAGR FILE MIGRATION VERIFICATION SUITE');
console.log('====================================================');

let passed = 0;
let failed = 0;

function assert(cond: boolean, desc: string) {
  if (cond) {
    console.log(`  ✓ PASS: ${desc}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${desc}`);
    failed++;
  }
}

// ----------------------------------------------------
// TEST 1: SINGLE SOURCE OF TRUTH & UNIVERSE COUNT
// ----------------------------------------------------
console.log('\n--- 1. Single Source of Truth & Universe Count ---');
const totalStocks = getMasterCagrStocksCount();
assert(totalStocks === 1131, `Loaded exact universe count from master_stock_cagr.json: ${totalStocks} (expected: 1131)`);
assert(Object.keys(rawNewMaster).length === 1131, `Raw master JSON contains exactly 1131 equities`);

// ----------------------------------------------------
// TEST 2: REPRESENTATIVE VALUES (POSITIVE, NEGATIVE, ZERO, NULL)
// ----------------------------------------------------
console.log('\n--- 2. Representative Values Verification ---');

// Positive CAGR check
const reliance = getMasterStockCagr('RELIANCE');
assert(reliance !== null, 'RELIANCE master record found');
assert(reliance?.cagr13Y === 22.94, `Positive CAGR verified: RELIANCE 13Y = ${reliance?.cagr13Y}%`);

// Negative CAGR check
assert(reliance?.cagr1Y === -15, `Negative CAGR verified: RELIANCE 1Y = ${reliance?.cagr1Y}%`);
assert(reliance?.cagr5Y === -1, `Negative CAGR verified: RELIANCE 5Y = ${reliance?.cagr5Y}%`);

// Zero CAGR check
assert(reliance?.cagr3Y === 0, `Zero CAGR verified: RELIANCE 3Y = ${reliance?.cagr3Y}% (exact 0, not null)`);

// Null CAGR check (must remain null, never converted to 0)
const ptcil = getMasterStockCagr('PTCIL');
assert(ptcil !== null, 'PTCIL master record found');
assert(ptcil?.cagr1Y === null, `Null CAGR verified: PTCIL 1Y is null`);
assert(ptcil?.cagr3Y === null, `Null CAGR verified: PTCIL 3Y is null`);
assert(ptcil?.cagr5Y === null, `Null CAGR verified: PTCIL 5Y is null`);
assert(ptcil?.cagr10Y === null, `Null CAGR verified: PTCIL 10Y is null`);
assert(ptcil?.cagr15Y === null, `Null CAGR verified: PTCIL 15Y is null`);
assert(ptcil?.cagr1Y !== 0, 'Null CAGR did NOT convert to 0');

// ----------------------------------------------------
// TEST 3: DATA PROVENANCE PRESERVATION
// ----------------------------------------------------
console.log('\n--- 3. Data Provenance Preservation ---');
assert(reliance?.dataProvenance === 'SCREENER_AUDITED', `RELIANCE provenance: ${reliance?.dataProvenance} (expected: SCREENER_AUDITED)`);
assert(ptcil?.dataProvenance === 'NOT_FETCHED', `PTCIL provenance: ${ptcil?.dataProvenance} (expected: NOT_FETCHED)`);

let screenerAuditedCount = 0;
let notFetchedCount = 0;
let masterFileCount = 0;

for (const val of Object.values(rawNewMaster) as any[]) {
  if (val.dataProvenance === 'SCREENER_AUDITED') screenerAuditedCount++;
  else if (val.dataProvenance === 'NOT_FETCHED') notFetchedCount++;
  else if (val.dataProvenance === 'MASTER_CAGR_FILE') masterFileCount++;
}

console.log(`  Provenance breakdown across 1131 equities:`);
console.log(`    - SCREENER_AUDITED: ${screenerAuditedCount}`);
console.log(`    - NOT_FETCHED: ${notFetchedCount}`);
console.log(`    - MASTER_CAGR_FILE: ${masterFileCount}`);
assert(screenerAuditedCount > 0, `SCREENER_AUDITED count (${screenerAuditedCount}) > 0`);
assert(notFetchedCount > 0, `NOT_FETCHED count (${notFetchedCount}) > 0`);

// ----------------------------------------------------
// TEST 4: SCHEMA COMPATIBILITY & FIELD MAPPING
// ----------------------------------------------------
console.log('\n--- 4. Schema Compatibility & Field Mapping ---');

// Build dataset for sample stocks
const dummyEquityReliance: StockEquity = {
  symbol: 'RELIANCE',
  companyName: 'Reliance Industries Limited',
  sector: 'Energy minerals',
  industry: 'Oil refining/Marketing',
  capTier: 'HIGH',
  marketCapRank: 1,
  currentPrice: 1248,
};

const dummyEquityPtcil: StockEquity = {
  symbol: 'PTCIL',
  companyName: 'PTC Industries Ltd',
  sector: 'Producer manufacturing',
  industry: 'Metal fabrication',
  capTier: 'MID',
  marketCapRank: 254,
  currentPrice: 22355,
};

const dataset = buildStockCagrDataset([dummyEquityReliance, dummyEquityPtcil]);
assert(dataset.length === 2, 'buildStockCagrDataset returned 2 records');

const relRec = dataset[0];
assert(relRec.cagr13Y === 22.94, 'Dataset preserves 13Y CAGR');
assert(relRec.cagr1Y === -15, 'Dataset preserves 1Y negative CAGR');
assert(relRec.cagr3Y === 0, 'Dataset preserves 3Y zero CAGR');
assert(relRec.rsiLe30Touches === 25, `Dataset maps rsiLe30Touches: ${relRec.rsiLe30Touches} (expected: 25)`);
assert(relRec.ema100Touches === 121, `Dataset maps ema100Touches: ${relRec.ema100Touches} (expected: 121)`);
assert(relRec.ema200Touches === 96, `Dataset maps ema200Touches: ${relRec.ema200Touches} (expected: 96)`);
assert(relRec.dataProvenance === 'SCREENER_AUDITED', `Dataset maps dataProvenance: ${relRec.dataProvenance}`);

const ptcilRec = dataset[1];
assert(ptcilRec.cagr1Y === null, 'Dataset maps null cagr1Y for PTCIL');
assert(ptcilRec.cagr1Y !== 0, 'Dataset null cagr1Y is NOT 0');
assert(ptcilRec.dataProvenance === 'NOT_FETCHED', `Dataset maps dataProvenance for PTCIL: ${ptcilRec.dataProvenance}`);

// ----------------------------------------------------
// TEST 5: CAGRENGINE HARMONIZATION
// ----------------------------------------------------
console.log('\n--- 5. CagrEngine Harmonization ---');
const summaryReliance = CagrEngine.calculateStockCagr(dummyEquityReliance);
assert(summaryReliance.cagr13Y === 22.94, 'CagrEngine reads 13Y CAGR from master');
assert(summaryReliance.cagr1Y === -15, 'CagrEngine reads 1Y CAGR from master');
assert(summaryReliance.cagr3Y === 0, 'CagrEngine reads 3Y CAGR from master');
assert(summaryReliance.dataProvenance === 'SCREENER_AUDITED', 'CagrEngine preserves SCREENER_AUDITED provenance');

const summaryPtcil = CagrEngine.calculateStockCagr(dummyEquityPtcil);
assert(summaryPtcil.cagr1Y === null, 'CagrEngine leaves 1Y null for PTCIL');
assert(summaryPtcil.cagr1Y !== 0, 'CagrEngine null is not converted to 0');
assert(summaryPtcil.dataProvenance === 'NOT_FETCHED', 'CagrEngine preserves NOT_FETCHED provenance');

// ----------------------------------------------------
// TEST 6: SECTOR & INDUSTRY AGGREGATIONS
// ----------------------------------------------------
console.log('\n--- 6. Sector & Industry Aggregations ---');
const allStocks = Object.values(rawNewMaster).map((m: any) => ({
  symbol: m.symbol,
  companyName: m.companyName,
  sector: m.sector,
  industry: m.industry,
  capTier: m.capTier,
  marketCapRank: m.marketCapRank,
  currentPrice: m.currentPrice,
  marketCapValue: m.currentPrice * 1000,
})) as StockEquity[];

const stockCagrList = buildStockCagrDataset(allStocks);

const sectorDataset = calculateSectorCagrDataset(allStocks, stockCagrList);
assert(sectorDataset.length > 0, `Sector CAGR calculated: ${sectorDataset.length} sectors`);
assert(sectorDataset.some(s => s.dataProvenance === 'SCREENER_AUDITED'), 'Sector calculation reflects SCREENER_AUDITED provenance');

const industryDataset = calculateIndustryCagrDataset(allStocks, stockCagrList);
assert(industryDataset.length > 0, `Industry CAGR calculated: ${industryDataset.length} industries`);
assert(industryDataset.some(i => i.dataProvenance === 'SCREENER_AUDITED'), 'Industry calculation reflects SCREENER_AUDITED provenance');

// ----------------------------------------------------
// SUMMARY
// ----------------------------------------------------
console.log('\n====================================================');
console.log(`MIGRATION AUDIT: ${passed} PASSED, ${failed} FAILED`);
console.log('====================================================');

if (failed > 0) {
  process.exit(1);
}
