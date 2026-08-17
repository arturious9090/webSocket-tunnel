// Maps hostnames (subdomains) to connected tunnel clients' WebSocket connections.
// A single host can only be claimed by one client; re-claiming replaces the
// previous connection (the old connection is closed).

function normalizeSubdomain(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '');
}

export class TunnelRegistry {
  constructor({ domain }) {
    this.domain = domain.toLowerCase();
    // full hostname -> ws
    this.hosts = new Map();
    // ws -> full hostname
    this.wsToHostname = new Map();
  }

  buildHostname(subdomain) {
    if (subdomain) {
      return `${subdomain}.${this.domain}`;
    }
    return this.domain;
  }

  register(ws, subdomain) {
    const hostname = this.buildHostname(subdomain);

    const existing = this.hosts.get(hostname);
    if (existing && existing !== ws) {
      // another client owns this host; close it to release the host
      try {
        existing.close(4001, 'host reassigned');
      } catch {
        /* ignore */
      }
    }

    this.hosts.set(hostname, ws);
    this.wsToHostname.set(ws, hostname);
    return hostname;
  }

  unregister(ws) {
    const hostname = this.wsToHostname.get(ws);
    if (hostname === undefined) {
      return;
    }
    if (this.hosts.get(hostname) === ws) {
      this.hosts.delete(hostname);
    }
    this.wsToHostname.delete(ws);
  }

  getByHostname(hostname) {
    const host = String(hostname || '').toLowerCase();
    return this.hosts.get(host);
  }

  getBySubdomain(subdomain) {
    return this.hosts.get(this.buildHostname(subdomain));
  }

  hasHostname(hostname) {
    return this.getByHostname(hostname) !== undefined;
  }

  get size() {
    return this.hosts.size;
  }

  list() {
    const entries = [];
    for (const [hostname, ws] of this.hosts) {
      entries.push({
        hostname,
        subdomain: ws.subdomain || null,
        id: ws.id || null,
        connectedAt: ws.connectedAt || null,
      });
    }
    return entries;
  }
}
