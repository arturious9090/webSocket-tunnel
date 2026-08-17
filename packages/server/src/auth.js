// Authentication helpers for tunnel clients.
// Supports both a single shared `authToken` and per-client `authTokens`
// (each token may restrict which subdomains it can claim).

import { timingSafeEqual, createHash } from 'node:crypto';

function digest(value) {
  return createHash('sha256').update(String(value)).digest();
}

export function safeEqual(a, b) {
  const da = digest(a);
  const db = digest(b);
  if (da.length !== db.length) {
    return false;
  }
  return timingSafeEqual(da, db);
}

// Returns the rule object for a matching token, or null.
export function authorizeToken(config, token) {
  if (!token) {
    return null;
  }

  // Explicit per-client tokens take precedence.
  if (config.authTokens) {
    for (const [registeredToken, rule] of Object.entries(config.authTokens)) {
      if (safeEqual(token, registeredToken)) {
        return rule;
      }
    }
    // If per-client tokens are configured, the shared token is not used.
    return null;
  }

  if (config.authToken && safeEqual(token, config.authToken)) {
    return { subdomains: null };
  }

  return null;
}

export function isSubdomainAllowed(rule, subdomain) {
  if (!rule || !rule.subdomains || rule.subdomains.length === 0) {
    // No restriction means any subdomain (including the apex) is allowed.
    return true;
  }
  const normalized = String(subdomain || '').toLowerCase();
  return rule.subdomains.includes(normalized);
}