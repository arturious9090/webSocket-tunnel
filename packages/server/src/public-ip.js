// Determine the server's public IP address. A configured explicit IP always
// wins; otherwise an external service is queried. Cloudflare DNS A records for
// the wildcard domain are pointed at this address (DNS-only mode).

const IPV4_SERVICES = [
  'https://api.ipify.org',
  'https://ifconfig.me/ip',
  'https://ipv4.icanhazip.com',
];

async function queryFirst(urls) {
  for (const url of urls) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      let response;
      try {
        response = await fetch(url, { signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        continue;
      }

      const text = (await response.text()).trim();
      if (text) {
        return text;
      }
    } catch {
      // try next service
    }
  }

  return null;
}

export async function detectPublicIp() {
  const ipv4 = await queryFirst(IPV4_SERVICES);
  return ipv4;
}

export async function resolvePublicIp(config) {
  if (config.publicIp) {
    console.log('[public-ip] using configured public IP:', config.publicIp);
    return config.publicIp;
  }

  const detected = await detectPublicIp();
  if (!detected) {
    throw new Error(
      'could not detect public IP address automatically; set publicIp in config or PUBLIC_IP env var',
    );
  }

  console.log('[public-ip] detected public IP:', detected);
  return detected;
}