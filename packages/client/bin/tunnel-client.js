#!/usr/bin/env node

import { startTunnel } from '../src/tunnel.js';
import { loadClientConfig } from '../src/config.js';

async function main() {
  const config = loadClientConfig();
  await startTunnel(config);
}

main().catch((error) => {
  console.error('[tunnel-client] fatal error:', error);
  process.exit(1);
});