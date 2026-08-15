import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

const PORT = 3000;

const server = createServer((req, res) => {
  console.log('new', req.method, 'request on', req.url);

  try {
    const response = readFileSync('./test_page.html');

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
  console.log('local backend listening on port', PORT);
});