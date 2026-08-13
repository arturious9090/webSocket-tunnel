import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import os from 'node:os';

const DEFAULT_CONFIG_PATH = resolve(process.cwd(), 'tunnel-server.config.json');

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

function homeDir() {
  return os.homedir();
}

export class ConfigError extends Error {}

export function loadServerConfig(configPath = process.env.TUNNEL_CONFIG || DEFAULT_CONFIG_PATH) {
  const file = readConfigFile(configPath);

  // Cloudflare
  const cloudflareApiToken = env('CLOUDFLARE_API_TOKEN') || file.cloudflare?.apiToken || env('CLOUDFLARE_API_KEY');
  const cloudflareZoneId = env('CLOUDFLARE_ZONE_ID') || file.cloudflare?.zoneId;

  // ACME / domain
  const domain = env('TUNNEL_DOMAIN') || file.domain;
  const acmeEmail = env('ACME_EMAIL') || file.acme?.email;

  // Auth
  const authToken = env('TUNNEL_AUTH_TOKEN') || file.authToken;

  // Network
  const httpsPort = toNumber(env('HTTPS_PORT') || file.httpsPort, 443);
  const httpPort = toNumber(env('HTTP_PORT') || file.httpPort, 80);
  const publicIp = env('PUBLIC_IP') || file.publicIp || null;
  const certsDir = env('CERTS_DIR') || file.certsDir || resolve(process.cwd(), 'certs');

  const proxy = toBoolean(env('CLOUDFLARE_PROXY') || file.cloudflare?.proxy, false);

  const errors = [];
  if (!cloudflareApiToken) {
    errors.push('missing Cloudflare API token (config: cloudflare.apiToken or env CLOUDFLARE_API_TOKEN)');
  }
  if (!cloudflareZoneId) {
    errors.push('missing Cloudflare zone id (config: cloudflare.zoneId or env CLOUDFLARE_ZONE_ID)');
  }
  if (!domain) {
    errors.push('missing base domain (config: domain or env TUNNEL_DOMAIN)');
  }
  if (!acmeEmail) {
    errors.push('missing ACME email (config: acme.email or env ACME_EMAIL)');
  }
  if (!authToken) {
    errors.push('missing auth token (config: authToken or env TUNNEL_AUTH_TOKEN)');
  }

  if (errors.length) {
    throw new ConfigError('invalid server configuration:\n- ' + errors.join('\n- '));
  }

  return {
    cloudflare: {
      apiToken: cloudflareApiToken,
      zoneId: cloudflareZoneId,
      proxy,
    },
    domain,
    acme: {
      email: acmeEmail,
      production: toBoolean(env('ACME_PRODUCTION') || file.acme?.production, true),
    },
    authToken,
    httpsPort,
    httpPort,
    publicIp,
    certsDir,
    home: homeDir(),
    configPath,
  };
}