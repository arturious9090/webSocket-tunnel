#!/usr/bin/env node

import { startServer } from '../src/server.js';
import { loadServerConfig } from '../src/config.js';
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

  const configPath = parseConfigPath(argv);
  const config = loadServerConfig(configPath);
  // Graceful shutdown (SIGINT/SIGTERM) is wired inside startServer.
  await startServer(config);
}

function parseConfigPath(argv) {
  const configIndex = argv.findIndex((arg) => arg === '--config' || arg === '-c');
  if (configIndex !== -1 && argv[configIndex + 1]) {
    return argv[configIndex + 1];
  }
  for (const arg of argv) {
    if (arg.startsWith('--config=')) {
      return arg.slice('--config='.length);
    }
  }
  return undefined;
}

main().catch((error) => {
  console.error('[tunnel-server] fatal error:', error.message || error);
  process.exit(1);
});