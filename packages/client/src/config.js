import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const DEFAULT_CONFIG_PATH = resolve(process.cwd(), 'tunnel-client.config.json');

function readConfigFile(path) {
  if (!path || !existsSync(path)) {
    return {};
  }

  try {
    const raw = readFileSync(path, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`failed to read config file "${path}": ${error.message}`);
  }
}

function parseArgs(argv) {
  const args = {};
  const positional = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }

    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const eqIndex = key.indexOf('=');
      if (eqIndex !== -1) {
        const name = key.slice(0, eqIndex);
        const value = key.slice(eqIndex + 1);
        args[name] = value;
      } else {
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) {
          args[key] = true;
        } else {
          args[key] = next;
          i += 1;
        }
      }
    } else if (arg.startsWith('-') && arg.length > 1) {
      const key = arg.slice(1);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('-')) {
        args[key] = true;
      } else {
        args[key] = next;
        i += 1;
      }
    } else {
      positional.push(arg);
    }
  }

  return { args, positional };
}

function env(name) {
  const value = process.env[name];
  if (value === undefined || value === '') {
    return undefined;
  }
  return value;
}

function toNumber(value, fallback) {
  if (value === undefined || value === null) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export class ConfigError extends Error {}

export function loadClientConfig(argv = process.argv.slice(2)) {
  const { args, positional } = parseArgs(argv);

  const configPath = args.config || args.c || env('TUNNEL_CONFIG') || DEFAULT_CONFIG_PATH;
  const file = readConfigFile(configPath);

  const positionalPort = positional.find((value) => /^\d+$/.test(value));

  const server = args.server || args.s || env('TUNNEL_SERVER') || file.server;
  const token = args.token || args.t || env('TUNNEL_AUTH_TOKEN') || file.token;
  const subdomain = args.subdomain || args.host || env('TUNNEL_SUBDOMAIN') || file.subdomain || null;
  const localHost = args['local-host'] || env('LOCAL_HTTP_HOST') || file.localHost || 'localhost';
  const localPort = toNumber(args.port || args.p || positionalPort || env('LOCAL_HTTP_PORT') || file.port, 3000);
  const maxRetries = toNumber(args['max-retries'] || env('MAX_RETRIES') || file.maxRetries, 50);
  const legacyRetryTime = toNumber(args['retry-time'] || env('RETRY_TIME') || file.retryTime, null);
  const retryMinDelayMs = toNumber(
    args['retry-min-delay'] || env('RETRY_MIN_DELAY') || file.retryMinDelayMs || legacyRetryTime,
    500,
  );
  const retryMaxDelayMs = toNumber(
    args['retry-max-delay'] || env('RETRY_MAX_DELAY') || file.retryMaxDelayMs,
    Math.max(retryMinDelayMs, 30_000),
  );

  const errors = [];
  if (!server) {
    errors.push('missing server address (config: server, env TUNNEL_SERVER, or --server)');
  }
  if (!token) {
    errors.push('missing auth token (config: token, env TUNNEL_AUTH_TOKEN, or --token)');
  }

  if (errors.length) {
    throw new ConfigError('invalid client configuration:\n- ' + errors.join('\n- '));
  }

  return {
    server,
    token,
    subdomain,
    localHost,
    localPort,
    maxRetries,
    retryMinDelayMs,
    retryMaxDelayMs,
    configPath,
  };
}