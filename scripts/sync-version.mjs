#!/usr/bin/env node

import { verifyReleaseVersion } from './check-release-version.mjs';

try {
  const result = verifyReleaseVersion();
  console.log(`Release version ${result.version} is synchronized:`);
  for (const [source, version] of Object.entries(result.sources)) {
    console.log(`  ${source}: ${version}`);
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
