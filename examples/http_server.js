import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const PORT = Number(process.env.PORT || 3000);

const __dirname = dirname(fileURLToPath(import.meta.url));
const pagePath = resolve(__dirname, 'test_page.html');

const server = createServer((req, res) => {
  console.log('new', req.method, 'request on', req.url);

  try {
    const response = readFileSync(pagePath);

    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': response.length,
      'system-header': 'systemInfo',
    });
    res.end(response);
  } catch {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Internal Server Error');
  }
});

server.listen(PORT, () => {
  console.log('local demo backend listening on port', PORT);
});