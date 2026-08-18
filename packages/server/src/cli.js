import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { getUserConfigPath } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8'));

export const HELP_TEXT = `
Tunnel server — public HTTPS endpoint that routes traffic to local tunnel clients.

Usage:
  tunnel-server [options]
  tunnel-server init

Options:
  -c, --config <path>   Path to JSON config file (auto-discovered by default)
  -h, --help            Show this help
  -v, --version         Show version

Environment:
  CLOUDFLARE_API_TOKEN, CLOUDFLARE_ZONE_ID, TUNNEL_DOMAIN, ACME_EMAIL,
  TUNNEL_AUTH_TOKEN, ACME_PRODUCTION, CLOUDFLARE_PROXY, HTTPS_PORT, HTTP_PORT,
  PUBLIC_IP, CERTS_DIR, REQUEST_TIMEOUT_MS, TUNNEL_CONFIG

Example:
  tunnel-server init
  tunnel-server --config tunnel-server.config.json
`;

export function printVersion() {
  console.log(pkg.version);
}

function question(rl, text, fallback = null) {
  const suffix = fallback ? ` [${fallback}]` : '';
  return rl.question(`${text}${suffix}: `).then((answer) => {
    const trimmed = answer.trim();
    return trimmed || fallback;
  });
}

function toBoolean(value) {
  return /^(y|yes|true|1)$/i.test(String(value).trim());
}

export async function runInit(targetPath = getUserConfigPath()) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log('Tunnel server setup wizard\n');

    const domain = await question(rl, 'Base domain (e.g. example.com)');
    const cloudflareApiToken = await question(rl, 'Cloudflare API token (Zone:DNS:Edit)');
    const cloudflareZoneId = await question(rl, 'Cloudflare Zone ID');
    const acmeEmail = await question(rl, 'Email for Let\'s Encrypt');
    const production = toBoolean(await question(rl, 'Use production Let\'s Encrypt? (y/N)', 'n'));
    const httpsPort = await question(rl, 'HTTPS port', '443');
    const httpPort = await question(rl, 'HTTP redirect port', '80');

    if (!domain || !cloudflareApiToken || !cloudflareZoneId || !acmeEmail) {
      console.error('domain, Cloudflare API token, Zone ID and ACME email are required.');
      process.exitCode = 1;
      return;
    }

    const authToken = randomBytes(32).toString('hex');

    const config = {
      cloudflare: {
        apiToken: cloudflareApiToken.trim(),
        zoneId: cloudflareZoneId.trim(),
        proxy: false,
      },
      domain: domain.trim(),
      acme: {
        email: acmeEmail.trim(),
        production,
      },
      authToken,
      httpsPort: Number(httpsPort) || 443,
      httpPort: Number(httpPort) || 80,
      publicIp: null,
      certsDir: './certs',
      requestTimeoutMs: 30000,
    };

    if (existsSync(targetPath)) {
      const answer = await question(rl, `Config ${targetPath} already exists. Overwrite? (y/N)`, 'n');
      if (!/^y(es)?$/i.test(answer.trim())) {
        console.log('Aborted.');
        return;
      }
    }

    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, JSON.stringify(config, null, 2) + '\n');
    console.log(`\nConfig written to ${targetPath}`);
    console.log('Run: tunnel-server');
    console.log(`# Share this client token with people who need to expose a service:`);
    console.log(authToken);
  } finally {
    rl.close();
  }
}