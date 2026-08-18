#!/usr/bin/env node

import { startTunnel } from '../src/tunnel.js';
import { loadClientConfig } from '../src/config.js';
import { HELP_TEXT, printVersion, runInit } from '../src/cli.js';

async function main() {
  const argv = process.argv.slice(2);

  if (argv.includes('init')) {
    await runInit();
    return;
  }

  if (argv.includes('-h') || argv.includes('--help')) {
    console.log(HELP_TEXT.trimStart());
    return;
  }

  if (argv.includes('-v') || argv.includes('--version')) {
    printVersion();
    return;
  }

  const config = loadClientConfig(argv);
  await startTunnel(config);
}

main().catch((error) => {
  console.error('[tunnel-client] fatal error:', error.message || error);
  process.exit(1);
});