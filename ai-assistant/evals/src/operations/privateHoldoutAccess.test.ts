import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { makeScratchDir, removeScratchDir } from '../test-helpers/scratchDir.js';
import { verifyPrivateHoldoutAccess } from './privateHoldoutAccess.js';

function privateManifest(scenarioIds: string[]): { root: string; path: string } {
  const root = mkdtempSync(path.join(tmpdir(), 'headlamp-private-holdout-'));
  const manifestPath = path.join(root, 'manifest.json');
  writeFileSync(
    manifestPath,
    JSON.stringify({
      schema_version: '1.0.0',
      created_at: '2026-09-12T00:00:00Z',
      scenario_ids: scenarioIds,
    }),
    { mode: 0o600 }
  );
  chmodSync(root, 0o700);
  return { root, path: manifestPath };
}

test('private holdout verification passes without disclosing identities', () => {
  const checkout = makeScratchDir('holdout-checkout');
  const privateStore = privateManifest(['private-alpha', 'private-beta']);
  try {
    writeFileSync(path.join(checkout, 'public.json'), '{"scenario_id":"public-case"}');
    const result = verifyPrivateHoldoutAccess({
      manifestPath: privateStore.path,
      checkoutRoot: checkout,
      publicRoots: [checkout],
      expectedCount: 2,
    });
    assert.equal(result.access_control_verification, 'passed');
    assert.equal(result.holdout_count, 2);
    assert.deepEqual(result.leak_paths, []);
    assert.doesNotMatch(JSON.stringify(result), /private-alpha|private-beta/);
  } finally {
    removeScratchDir(checkout);
    rmSync(privateStore.root, { recursive: true, force: true });
  }
});

test('private holdout verification fails closed on leaks, permissions, count, and location', () => {
  const checkout = makeScratchDir('holdout-failure');
  const privateDirectory = path.join(checkout, 'private');
  mkdirSync(privateDirectory, { mode: 0o755 });
  const manifestPath = path.join(privateDirectory, 'manifest.json');
  writeFileSync(
    manifestPath,
    JSON.stringify({
      schema_version: '1.0.0',
      created_at: '2026-09-12T00:00:00Z',
      scenario_ids: ['private-leaked'],
    }),
    { mode: 0o644 }
  );
  writeFileSync(path.join(checkout, 'report.json'), 'private-leaked');
  try {
    const result = verifyPrivateHoldoutAccess({
      manifestPath,
      checkoutRoot: checkout,
      publicRoots: [checkout],
      expectedCount: 25,
    });
    assert.equal(result.access_control_verification, 'failed');
    assert.deepEqual(result.checks, {
      outside_checkout: false,
      owner_only: false,
      expected_count: false,
      unique_identities: true,
      public_scan_clean: false,
    });
    assert.deepEqual(result.leak_paths, ['private/manifest.json', 'report.json']);
    assert.doesNotMatch(JSON.stringify(result), /private-leaked/);
  } finally {
    removeScratchDir(checkout);
  }
});
