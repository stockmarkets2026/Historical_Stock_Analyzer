/**
 * TEST SUITE: DriveDataManager and Local Parquet Cache Layer
 * 
 * Verifies:
 * 1. Drive metadata lookup & file resolution
 * 2. Cache creation (staging -> validation -> atomic promotion)
 * 3. Cache reuse (zero network transfer on matching MD5/modifiedTime)
 * 4. Stale-cache detection (detects updated remote checksums/timestamps)
 * 5. Invalid/corrupt download handling (corrupt buffers rejected, valid cache preserved)
 * 6. Offline cached mode (loads from local cache seamlessly)
 * 7. DATA_UNAVAILABLE status when cache missing and Drive disconnected
 */

import {
  validateParquetBinary,
  stageTempDownload,
  getTempDownload,
  discardTempDownload,
  atomicallyPromoteTempToActive,
  getActiveCachedDataset,
  getCacheManifestEntry,
  isCacheStale,
  getParquetCacheSummary,
  clearParquetCache,
} from './src/services/driveCacheService.js';
import {
  setConfiguredDriveFileIds,
  getConfiguredDriveFileIds,
  loadFromOfflineCache,
  getDriveDataManagerState,
} from './src/services/driveDataManager.js';

// Helper to create synthetic valid minimal Parquet buffer
// 4 bytes 'PAR1' header + dummy body + 4 bytes 'PAR1' footer
function createSyntheticParquetBuffer(size = 64): ArrayBuffer {
  const buf = new ArrayBuffer(size);
  const u8 = new Uint8Array(buf);
  // 'PAR1' header: [0x50, 0x41, 0x52, 0x31]
  u8[0] = 0x50; u8[1] = 0x41; u8[2] = 0x52; u8[3] = 0x31;
  // Fill middle with arbitrary dummy data
  for (let i = 4; i < size - 4; i++) {
    u8[i] = (i * 7) % 256;
  }
  // 'PAR1' footer: [0x50, 0x41, 0x52, 0x31]
  u8[size - 4] = 0x50; u8[size - 3] = 0x41; u8[size - 2] = 0x52; u8[size - 1] = 0x31;
  return buf;
}

// Helper to create synthetic corrupt / non-parquet buffer
function createCorruptBuffer(size = 64): ArrayBuffer {
  const buf = new ArrayBuffer(size);
  const u8 = new Uint8Array(buf);
  // Fill with non-PAR1 bytes (e.g. HTML error page or broken text)
  for (let i = 0; i < size; i++) {
    u8[i] = 0x41; // 'AAAA...'
  }
  return buf;
}

let passedTests = 0;
let totalTests = 0;

function assert(condition: boolean, testName: string, detail?: string) {
  totalTests++;
  if (condition) {
    console.log(`  ✓ PASS: ${testName}`);
    passedTests++;
  } else {
    console.error(`  ✗ FAIL: ${testName} ${detail ? `(${detail})` : ''}`);
  }
}

async function runTests() {
  console.log('====================================================');
  console.log('STARTING DRIVEDATAMANAGER & CACHE UNIT TESTS');
  console.log('====================================================\n');

  await clearParquetCache();

  // ----------------------------------------------------
  // TEST 1: Parquet Validation (Magic Bytes Check)
  // ----------------------------------------------------
  console.log('--- TEST GROUP 1: Parquet Binary Validation ---');
  const validParquet = createSyntheticParquetBuffer(128);
  const corruptParquet = createCorruptBuffer(128);
  const emptyBuffer = new ArrayBuffer(0);
  const tooSmallBuffer = new ArrayBuffer(8);

  const valValid = validateParquetBinary(validParquet);
  assert(valValid.isValid === true, 'Valid Parquet buffer accepted');

  const valCorrupt = validateParquetBinary(corruptParquet);
  assert(valCorrupt.isValid === false, 'Corrupt non-PAR1 buffer rejected', valCorrupt.reason);

  const valEmpty = validateParquetBinary(emptyBuffer);
  assert(valEmpty.isValid === false, 'Empty 0-byte buffer rejected');

  const valSmall = validateParquetBinary(tooSmallBuffer);
  assert(valSmall.isValid === false, 'Too-small (<12 bytes) buffer rejected');

  // ----------------------------------------------------
  // TEST 2: Configured Drive File IDs Management
  // ----------------------------------------------------
  console.log('\n--- TEST GROUP 2: Configured File IDs Preference ---');
  setConfiguredDriveFileIds({
    largecapFileId: 'drive-id-largecap-001',
    midcapFileId: 'drive-id-midcap-002',
    smallcapFileId: 'drive-id-smallcap-003',
    masterFileId: 'drive-id-master-000',
  });

  const configured = getConfiguredDriveFileIds();
  assert(configured.largecapFileId === 'drive-id-largecap-001', 'Configured largecap File ID stored');
  assert(configured.masterFileId === 'drive-id-master-000', 'Configured master File ID stored');

  // ----------------------------------------------------
  // TEST 3: Staging, Validation & Atomic Promotion
  // ----------------------------------------------------
  console.log('\n--- TEST GROUP 3: Staging & Atomic Cache Promotion ---');
  await stageTempDownload('largecap', validParquet);
  const staged = await getTempDownload('largecap');
  assert(staged !== null && staged.byteLength === 128, 'File staged in temp buffer without affecting active cache');

  let activeBefore = await getActiveCachedDataset('largecap');
  assert(activeBefore === null, 'Active cache is empty prior to promotion');

  const promoteRes = await atomicallyPromoteTempToActive({
    datasetKey: 'largecap',
    fileName: 'Largecap.parquet',
    driveFileId: 'drive-id-largecap-001',
    md5Checksum: 'md5-hash-v1',
    modifiedTime: '2026-10-07T12:00:00Z',
    sizeBytes: 128,
    cachedAt: Date.now(),
    isValidParquet: true,
  });

  assert(promoteRes.success === true, 'Atomic promotion succeeded');
  const activeAfter = await getActiveCachedDataset('largecap');
  assert(activeAfter !== null && activeAfter.isValidParquet === true, 'Active cache now populated with valid Parquet');
  const stagedAfter = await getTempDownload('largecap');
  assert(stagedAfter === null, 'Staged temporary buffer cleaned up after promotion');

  // ----------------------------------------------------
  // TEST 4: Cache Reuse & Stale-Cache Detection
  // ----------------------------------------------------
  console.log('\n--- TEST GROUP 4: Cache Reuse & Stale Detection ---');
  const manifest = await getCacheManifestEntry('largecap');
  assert(manifest !== null, 'Cache manifest retrieved');

  // Same checksum + timestamp -> NOT stale (Reuse Cache)
  const isStaleSame = isCacheStale(manifest, {
    id: 'drive-id-largecap-001',
    md5Checksum: 'md5-hash-v1',
    modifiedTime: '2026-10-07T12:00:00Z',
  });
  assert(isStaleSame === false, 'Cache matches remote metadata -> NOT stale (0 bytes network re-download)');

  // Different checksum -> STALE (Trigger Download)
  const isStaleNewChecksum = isCacheStale(manifest, {
    id: 'drive-id-largecap-001',
    md5Checksum: 'md5-hash-v2-updated',
    modifiedTime: '2026-10-07T14:00:00Z',
  });
  assert(isStaleNewChecksum === true, 'Different remote MD5 detected -> STALE (Triggers sync)');

  // Different modifiedTime -> STALE
  const isStaleNewTime = isCacheStale(manifest, {
    id: 'drive-id-largecap-001',
    md5Checksum: 'md5-hash-v1',
    modifiedTime: '2026-10-07T16:00:00Z',
  });
  assert(isStaleNewTime === false, 'Matching MD5 takes precedence over timestamp');

  const isStaleNoMd5NewTime = isCacheStale(
    { ...manifest!, md5Checksum: undefined },
    {
      id: 'drive-id-largecap-001',
      modifiedTime: '2026-10-07T16:00:00Z',
    }
  );
  assert(isStaleNoMd5NewTime === true, 'Updated modifiedTime detected when MD5 not available');

  // ----------------------------------------------------
  // TEST 5: Corrupt Download Protection (Preserve Cache)
  // ----------------------------------------------------
  console.log('\n--- TEST GROUP 5: Corrupt Download Protection ---');
  // Attempt to stage and promote a corrupt buffer
  await stageTempDownload('largecap', corruptParquet);
  const corruptPromote = await atomicallyPromoteTempToActive({
    datasetKey: 'largecap',
    fileName: 'Largecap.parquet',
    driveFileId: 'drive-id-largecap-001',
    md5Checksum: 'corrupt-md5',
    modifiedTime: '2026-10-07T18:00:00Z',
    sizeBytes: 128,
    cachedAt: Date.now(),
    isValidParquet: false,
  });

  assert(corruptPromote.success === false, 'Promotion of corrupt buffer rejected by validator');
  const preservedActive = await getActiveCachedDataset('largecap');
  assert(
    preservedActive !== null && preservedActive.md5Checksum === 'md5-hash-v1',
    'Active valid cache preserved intact and NOT overwritten by corrupt download'
  );

  // ----------------------------------------------------
  // TEST 6: Offline Cached Mode & DATA_UNAVAILABLE
  // ----------------------------------------------------
  console.log('\n--- TEST GROUP 6: Offline Mode & DATA_UNAVAILABLE ---');
  // With largecap in cache:
  const offlineRes = await loadFromOfflineCache();
  assert(offlineRes.success === true, 'Offline cache loaded successfully when cached file exists');
  assert(offlineRes.loadedKeys.includes('largecap'), 'largecap loaded in offline mode');

  const dmState = getDriveDataManagerState();
  assert(dmState.status === 'offline_cached', 'DriveDataManager state correctly reports offline_cached');

  // Clear cache to test DATA_UNAVAILABLE
  await clearParquetCache();
  const emptyOfflineRes = await loadFromOfflineCache();
  assert(emptyOfflineRes.success === false, 'Offline load fails when cache is empty');
  const emptyState = getDriveDataManagerState();
  assert(emptyState.status === 'DATA_UNAVAILABLE', 'State correctly reports DATA_UNAVAILABLE when cache is empty and offline');

  console.log('\n====================================================');
  console.log(`TEST SUMMARY: ${passedTests}/${totalTests} TESTS PASSED`);
  console.log('====================================================');

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
