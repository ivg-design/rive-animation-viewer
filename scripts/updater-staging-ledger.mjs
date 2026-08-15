import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createUpdaterStagingLedger,
  verifyUpdaterAcceptanceReceipt,
  verifyUpdaterStagingLedger,
} from './updater-acceptance-lib.mjs';

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const args = { command };
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const value = rest[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${token} requires a value`);
    args[token.slice(2)] = value;
    index += 1;
  }
  return args;
}

function requireArgs(args, names) {
  for (const name of names) {
    if (!args[name]) throw new Error(`--${name} is required`);
  }
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.command === 'create') {
    requireArgs(args, ['asset-dir', 'commit', 'config', 'output', 'release-file', 'release-id', 'repository', 'version']);
    await createUpdaterStagingLedger({
      assetDir: args['asset-dir'], commit: args.commit, configPath: args.config,
      output: args.output, releaseFile: args['release-file'], releaseId: args['release-id'],
      repository: args.repository, version: args.version,
    });
    return;
  }
  if (args.command === 'verify') {
    requireArgs(args, ['asset-dir', 'commit', 'config', 'ledger', 'release-id', 'repository']);
    await verifyUpdaterStagingLedger({
      assetDir: args['asset-dir'], configPath: args.config, expectedCommit: args.commit,
      expectedReleaseId: args['release-id'], expectedRepository: args.repository,
      ledgerPath: args.ledger,
    });
    return;
  }
  if (args.command === 'verify-receipt') {
    requireArgs(args, ['ledger', 'receipt']);
    verifyUpdaterAcceptanceReceipt({ ledgerPath: args.ledger, receiptPath: args.receipt });
    return;
  }
  throw new Error('Usage: updater-staging-ledger.mjs <create|verify|verify-receipt> [options]');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
