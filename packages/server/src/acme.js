// Automatic Let's Encrypt wildcard certificate management via ACME DNS-01.
// Uses the Cloudflare DNS adapter to satisfy the challenge, so the server can
// obtain a single wildcard certificate (*.domain.com) that covers all subdomains.

import * as acme from 'acme-client';
import {
  existsSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
} from 'node:fs';
import { createCloudflareDnsAdapter } from './cloudflare.js';

const RENEW_BEFORE_MS = 15 * 24 * 60 * 60 * 1000; // renew 15 days before expiry

function log(...args) {
  console.log('[acme]', ...args);
}

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function readCertIfValid(certsDir, domain) {
  const certPath = `${certsDir}/${domain}/cert.pem`;
  const keyPath = `${certsDir}/${domain}/key.pem`;

  if (!existsSync(certPath) || !existsSync(keyPath)) {
    return null;
  }

  try {
    const cert = readFileSync(certPath, 'utf8');
    const info = acme.crypto.readCertificateInfo(cert);
    const now = Date.now();
    const expiresAt = info.notAfter.getTime();

    if (expiresAt - now <= RENEW_BEFORE_MS) {
      log(`certificate for ${domain} expires soon (${info.notAfter.toISOString()}), renewing`);
      return null;
    }

    log(`certificate for ${domain} is valid until ${info.notAfter.toISOString()}`);
    return {
      cert,
      key: readFileSync(keyPath, 'utf8'),
      expiresAt,
    };
  } catch (error) {
    log(`failed to read cached certificate for ${domain}: ${error.message}`);
    return null;
  }
}

function writeCert(certsDir, domain, cert, key) {
  const dir = `${certsDir}/${domain}`;
  ensureDir(dir);
  writeFileSync(`${dir}/cert.pem`, cert, { mode: 0o600 });
  writeFileSync(`${dir}/key.pem`, key, { mode: 0o600 });
  log(`certificate saved to ${dir}`);
}

async function issueCertificate({ config, domain, altNames }) {
  const accountKey = await acme.crypto.createPrivateRsaKey();
  const [csrKey, csr] = await acme.crypto.createCsr({
    commonName: domain,
    altNames,
  });

  const dnsAdapter = createCloudflareDnsAdapter({
    apiToken: config.cloudflare.apiToken,
    zoneId: config.cloudflare.zoneId,
  });

  const directoryUrl = config.acme.production
    ? acme.directory.letsencrypt.production
    : acme.directory.letsencrypt.staging;

  const client = new acme.Client({
    directoryUrl,
    accountKey,
  });

  log(`issuing certificate for ${domain} (${altNames.join(', ')}) via ${directoryUrl}`);

  const certificate = await client.auto({
    csr,
    email: config.acme.email,
    termsOfServiceAgreed: true,
    challengePriority: ['dns-01'],
    skipChallengeVerification: true,
    challengeCreateFn: async (authz, challenge, keyAuthorization) => {
      const recordName = `_acme-challenge.${authz.identifier.value}`;
      log('creating DNS-01 TXT record', recordName);
      await dnsAdapter.set({ name: recordName, value: keyAuthorization });
    },
    challengeRemoveFn: async (authz, challenge, keyAuthorization) => {
      const recordName = `_acme-challenge.${authz.identifier.value}`;
      log('removing DNS-01 TXT record', recordName);
      await dnsAdapter.remove({ name: recordName, value: keyAuthorization });
    },
  });

  // csrKey is the private key corresponding to the issued certificate.
  return { cert: certificate, key: csrKey.toString() };
}

export async function ensureCertificate(config) {
  const domain = config.domain;
  const altNames = [`*.${domain}`, domain];

  ensureDir(config.certsDir);
  const cached = readCertIfValid(config.certsDir, domain);
  if (cached) {
    return cached;
  }

  const issued = await issueCertificate({ config, domain, altNames });
  writeCert(config.certsDir, domain, issued.cert, issued.key);

  const info = acme.crypto.readCertificateInfo(issued.cert);
  return {
    cert: issued.cert,
    key: issued.key,
    expiresAt: info.notAfter.getTime(),
  };
}