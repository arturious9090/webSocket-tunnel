import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8'));

export const HELP_TEXT = `
Tunnel client — expose a local HTTP service via the public WebSocket tunnel.

Usage:
  tunnel-client [options]
  tunnel-client <port>
  tunnel-client init

Positional:
  <port>                      Shortcut for --port <port> (forwards localhost:<port>)

Options:
  -s, --server <url>          Tunnel server address (domain or wss://...)
  -t, --token <token>         Shared auth token
      --subdomain <name>      Subdomain to register ("app" -> app.example.com)
      --local-host <host>     Local service host (default: localhost)
  -p, --port <port>           Local service port (default: 3000)
      --max-retries <n>       Max reconnect attempts (default: 50)
      --retry-min-delay <ms>  Min reconnect delay (default: 500)
      --retry-max-delay <ms>  Max reconnect delay (default: 30000)
  -c, --config <path>         Path to JSON config file
  -h, --help                  Show this help
  -v, --version               Show version

Environment:
  TUNNEL_SERVER, TUNNEL_AUTH_TOKEN, TUNNEL_SUBDOMAIN, LOCAL_HTTP_HOST,
  LOCAL_HTTP_PORT, MAX_RETRIES, RETRY_MIN_DELAY, RETRY_MAX_DELAY, TUNNEL_CONFIG

Examples:
  tunnel-client init
  tunnel-client --server tunnel.example.com --token SECRET --subdomain app --port 3000
  tunnel-client 3000
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

export async function runInit(targetPath = resolve(process.cwd(), 'tunnel-client.config.json')) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log('Tunnel client setup wizard\n');

    const server = await question(rl, 'Tunnel server address (domain or wss://...)');
    const token = await question(rl, 'Shared auth token');
    const subdomain = await question(rl, 'Subdomain', 'app');
    const localHost = await question(rl, 'Local host', 'localhost');
    const port = await question(rl, 'Local port', '3000');

    if (!server || !token) {
      console.error('server and token are required.');
      process.exitCode = 1;
      return;
    }

    const config = {
      server: server.trim(),
      token: token.trim(),
      subdomain: (subdomain || '').trim() || null,
      localHost: (localHost || '').trim() || 'localhost',
      port: Number(port) || 3000,
      maxRetries: 50,
      retryMinDelayMs: 500,
      retryMaxDelayMs: 30000,
    };

    if (existsSync(targetPath)) {
      const answer = await question(rl, `Config ${targetPath} already exists. Overwrite? (y/N)`, 'n');
      if (!/^y(es)?$/i.test(answer.trim())) {
        console.log('Aborted.');
        return;
      }
    }

    writeFileSync(targetPath, JSON.stringify(config, null, 2) + '\n');
    console.log(`\nConfig written to ${targetPath}`);
    console.log(`Run: tunnel-client --config ${targetPath}`);
  } finally {
    rl.close();
  }
}

export function generateToken() {
  return randomBytes(32).toString('hex');
}