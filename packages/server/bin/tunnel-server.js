#!/usr/bin/env node

import { startServer } from '../src/server.js';
import { loadServerConfig } from '../src/config.js';

async function main() {
  const config = loadServerConfig();
  await startServer(config);
}

main().catch((error) => {
  console.error('[tunnel-server] fatal error:', error);
  process.exit(1);
});