import { lstatSync, readFileSync, readdirSync, realpathSync, statSync, type Stats } from 'node:fs';
import path from 'node:path';
import { sha256OfJson, sha256OfText, type JsonValue } from '../canonicalJson.js';
import { loadSchema } from '../contracts/schemas.js';
import { assertValid } from '../contracts/validate.js';

export interface PrivateHoldoutManifest {
  schema_version: '1.0.0';
  created_at: string;
  scenario_ids: string[];
}

export interface PrivateHoldoutVerification {
  access_control_verification: 'passed' | 'failed';
  holdout_count: number;
  manifest_digest: string;
  identity_set_digest: string;
  checks: {
    outside_checkout: boolean;
    owner_only: boolean;
    expected_count: boolean;
    unique_identities: boolean;
    public_scan_clean: boolean;
  };
  leak_paths: string[];
}

const ignoredPublicDirectories = new Set(['.git', '.test-scratch', 'node_modules']);

function isOwnerOnly(stats: Stats): boolean {
  return (stats.mode & 0o077) === 0;
}

function isOutside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative.startsWith(`..${path.sep}`) || relative === '..';
}

function publicFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (entryPath: string): void => {
    const stats = lstatSync(entryPath);
    if (stats.isSymbolicLink()) return;
    if (stats.isDirectory()) {
      for (const entry of readdirSync(entryPath, { withFileTypes: true })) {
        if (entry.isDirectory() && ignoredPublicDirectories.has(entry.name)) continue;
        visit(path.join(entryPath, entry.name));
      }
    } else if (stats.isFile()) {
      files.push(entryPath);
    }
  };
  visit(root);
  return files;
}

/** Verifies private storage isolation and scans ordinary public storage for exact identity leaks. */
export function verifyPrivateHoldoutAccess(input: {
  manifestPath: string;
  checkoutRoot: string;
  publicRoots: string[];
  expectedCount: number;
}): PrivateHoldoutVerification {
  const manifestPath = realpathSync(input.manifestPath);
  const privateRoot = realpathSync(path.dirname(manifestPath));
  const checkoutRoot = realpathSync(input.checkoutRoot);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PrivateHoldoutManifest;
  assertValid(loadSchema('private-holdout-manifest'), manifest, 'private holdout manifest');

  const identities = [...manifest.scenario_ids].sort();
  const uniqueIdentities = new Set(identities);
  const leakPaths = new Set<string>();
  for (const publicRootInput of input.publicRoots) {
    const publicRoot = realpathSync(publicRootInput);
    for (const filePath of publicFiles(publicRoot)) {
      const contents = readFileSync(filePath);
      if (identities.some(identity => contents.includes(Buffer.from(identity)))) {
        leakPaths.add(path.relative(checkoutRoot, filePath) || '.');
      }
    }
  }

  const checks = {
    outside_checkout: isOutside(privateRoot, checkoutRoot),
    owner_only: isOwnerOnly(statSync(privateRoot)) && isOwnerOnly(statSync(manifestPath)),
    expected_count: identities.length === input.expectedCount,
    unique_identities: uniqueIdentities.size === identities.length,
    public_scan_clean: leakPaths.size === 0,
  };
  return {
    access_control_verification: Object.values(checks).every(Boolean) ? 'passed' : 'failed',
    holdout_count: identities.length,
    manifest_digest: sha256OfText(readFileSync(manifestPath, 'utf8')),
    identity_set_digest: sha256OfJson(identities as unknown as JsonValue),
    checks,
    leak_paths: [...leakPaths].sort(),
  };
}
