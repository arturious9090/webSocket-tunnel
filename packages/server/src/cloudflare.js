// Minimal Cloudflare API client for DNS record management (DNS-only mode).
// Only the operations needed by the tunnel server are implemented:
// - create/update the wildcard A record pointing to the server's public IP
// - create/delete TXT records for ACME DNS-01 challenges

const CF_API_BASE = 'https://api.cloudflare.com/client/v4';

export class CloudflareError extends Error {
  constructor(message, { status, errors } = {}) {
    super(message);
    this.name = 'CloudflareError';
    this.status = status;
    this.errors = errors || [];
  }
}

async function cfRequest({ apiToken, zoneId, path, method = 'GET', body }) {
  const url = `${CF_API_BASE}/zones/${encodeURIComponent(zoneId)}${path}`;

  const headers = {
    Authorization: `Bearer ${apiToken}`,
    'Content-Type': 'application/json',
  };

  const options = {
    method,
    headers,
  };

  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    throw new CloudflareError(`Cloudflare request failed: ${error.message}`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new CloudflareError(
      `Cloudflare returned non-JSON response (HTTP ${response.status})`,
      { status: response.status },
    );
  }

  if (!response.ok || payload.success === false) {
    const apiErrors = payload.errors || [];
    const message = apiErrors
      .map((err) => err.message || JSON.stringify(err))
      .join('; ') || `Cloudflare API returned HTTP ${response.status}`;

    // Surface actionable context for the most common misconfiguration.
    let hint = '';
    if (/authentication/i.test(message) || response.status === 403 || response.status === 401) {
      hint =
        'Check CLOUDFLARE_API_TOKEN (or config cloudflare.apiToken): it must be a valid Cloudflare API token with Zone > DNS > Edit permission for this zone.';
    } else if (/zone/i.test(message) || response.status === 404) {
      hint =
        'Check CLOUDFLARE_ZONE_ID (or config cloudflare.zoneId): make sure it belongs to the zone managed by this API token.';
    }

    throw new CloudflareError(hint ? `${message} — ${hint}` : message, {
      status: response.status,
      errors: apiErrors,
    });
  }

  return payload.result;
}

export async function listDnsRecords({ apiToken, zoneId, name, type }) {
  const params = new URLSearchParams();
  if (name) {
    params.set('name', name);
  }
  if (type) {
    params.set('type', type);
  }
  params.set('per_page', '100');

  const results = [];
  let page = 1;
  for (;;) {
    params.set('page', String(page));
    const path = `/dns_records?${params.toString()}`;
    const batch = await cfRequest({ apiToken, zoneId, path });
    results.push(...batch);
    if (!Array.isArray(batch) || batch.length < 100) {
      break;
    }
    page += 1;
  }
  return results;
}

export async function upsertARecord({ apiToken, zoneId, name, content, proxied = false }) {
  const records = await listDnsRecords({ apiToken, zoneId, name, type: 'A' });

  const existing = records.find((record) => record.type === 'A' && record.name === name);

  if (existing) {
    if (existing.content === content && existing.proxied === proxied) {
      return existing;
    }

    return cfRequest({
      apiToken,
      zoneId,
      path: `/dns_records/${existing.id}`,
      method: 'PATCH',
      body: { content, proxied },
    });
  }

  return cfRequest({
    apiToken,
    zoneId,
    path: '/dns_records',
    method: 'POST',
    body: {
      type: 'A',
      name,
      content,
      proxied,
      ttl: 1, // automatic
    },
  });
}

export async function createTxtRecord({ apiToken, zoneId, name, content }) {
  return cfRequest({
    apiToken,
    zoneId,
    path: '/dns_records',
    method: 'POST',
    body: {
      type: 'TXT',
      name,
      content,
      ttl: 1,
    },
  });
}

export async function deleteTxtRecord({ apiToken, zoneId, name, content }) {
  const records = await listDnsRecords({ apiToken, zoneId, name, type: 'TXT' });

  const matching = records.filter(
    (record) =>
      record.type === 'TXT' &&
      record.name === name &&
      (record.content === content || record.content.replace(/^"|"$/g, '') === content),
  );

  for (const record of matching) {
    await cfRequest({
      apiToken,
      zoneId,
      path: `/dns_records/${record.id}`,
      method: 'DELETE',
    });
  }

  return matching.length;
}

export async function upsertTxtRecord({ apiToken, zoneId, name, content, ttl = 120 }) {
  const records = await listDnsRecords({ apiToken, zoneId, name, type: 'TXT' });

  const existing = records.find(
    (record) =>
      record.type === 'TXT' &&
      record.name === name &&
      (record.content === content || record.content.replace(/^"|"$/g, '') === content),
  );

  if (existing) {
    return existing;
  }

  return cfRequest({
    apiToken,
    zoneId,
    path: '/dns_records',
    method: 'POST',
    body: {
      type: 'TXT',
      name,
      content,
      ttl,
    },
  });
}

export function createCloudflareDnsAdapter({ apiToken, zoneId }) {
  return {
    apiToken,
    zoneId,
    set: (record) =>
      upsertTxtRecord({
        apiToken,
        zoneId,
        name: record.name,
        content: record.value,
      }),
    remove: (record) =>
      deleteTxtRecord({
        apiToken,
        zoneId,
        name: record.name,
        content: record.value,
      }),
  };
}