import http from 'node:http';
import { createHttpResponse, filterHeaders } from '@ws-tunnel/protocol';

export function createLocalForwarder({ host, port, log = console.log }) {
  function forwardRequestToLocal(httpRequest) {
    const { method, url, headers, body, bodyEncoding } = httpRequest;

    const requestBody = body
      ? Buffer.from(body, bodyEncoding || 'utf8')
      : null;

    const options = {
      host,
      port,
      path: url,
      method,
      headers: {
        ...filterHeaders(headers),
        ...(requestBody ? { 'content-length': requestBody.length } : {}),
      },
    };

    return new Promise((resolve) => {
      const req = http.request(options, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const responseBody = Buffer.concat(chunks);
          resolve(
            createHttpResponse({
              id: httpRequest.id,
              status: res.statusCode,
              headers: filterHeaders(res.headers),
              body: responseBody.length ? responseBody.toString('base64') : null,
              bodyEncoding: 'base64',
            }),
          );
        });
      });

      req.on('error', (error) => {
        log('local request failed:', error.message);
        resolve(
          createHttpResponse({
            id: httpRequest.id,
            status: 502,
            headers: { 'Content-Type': 'text/plain' },
            body: Buffer.from('local request failed: ' + error.message).toString('base64'),
            bodyEncoding: 'base64',
          }),
        );
      });

      if (requestBody) {
        req.write(requestBody);
      }
      req.end();
    });
  }

  return { forwardRequestToLocal };
}