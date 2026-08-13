import { createServer } from 'node:http';

const PORT = Number(process.env.LOCAL_HTTP_PORT || 8000);

const server = createServer();

server.on('request', (req, res) => {
  console.log('new', req.method, 'request on', req.url);

  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString();

    const response = JSON.stringify(
      {
        message: 'OKey',
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: body || null,
      },
      null,
      2,
    );

    res.writeHead(200, {
      'Content-Type': 'application/json',
      'system-header': 'systemInfo',
    });
    res.end(response);
  });
});

server.listen(PORT, () => {
  console.log('local backend listening on port', PORT);
});