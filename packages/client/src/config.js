import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import os from 'node:os';

const CONFIG_FILE_NAME = 'tunnel-client.config.json';
const USER_CONFIG_DIR = join(os.homedir(), '.ws-tunnel');

export function getUserConfigPath() {
  return join(USER_CONFIG_DIR, CONFIG_FILE_NAME);
}

export function getProjectConfigPath(cwd = process.cwd()) {
  return resolve(cwd, CONFIG_FILE_NAME);
}

// Ordered list of default config locations. The first existing file wins, so
// users can drop a project-local config next to their app or keep a single
// global config in ~/.ws-tunnel and never pass a path.
export function resolveConfigPaths({ explicit, cwd = process.cwd() } = {}) {
  if (explicit) {
    return [resolve(cwd, explicit)];
  }
  return [getProjectConfigPath(cwd), getUserConfigPath()];
}

function readConfigFile(path) {
  if (!path || !existsSync(path)) {
    return null;
  }

  try {
    const raw = readFileSync(path, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`failed to read config file "${path}": ${error.message}`);
  }
}

function readFirstConfig(paths) {
  for (const path of paths) {
    const file = readConfigFile(path);
    if (file) {
      return { file, path };
    }
  }
  return { file: {}, path: null };
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

function toBoolean(value, fallback = false) {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  const normalized = String(value).toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

export class ConfigError extends Error {}

export function loadClientConfig(argv = process.argv.slice(2)) {
  const { args, positional } = parseArgs(argv);

  const explicit = args.config || args.c || env('TUNNEL_CONFIG');
  const { file, path: configPath } = readFirstConfig(resolveConfigPaths({ explicit }));

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
  const insecure = toBoolean(args.insecure || env('TUNNEL_INSECURE') || file.insecure, false);
  const ca = args.ca || env('TUNNEL_CA') || file.ca || null;

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
    insecure,
    ca,
    configPath,
  };
}