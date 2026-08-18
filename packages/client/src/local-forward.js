import http from 'node:http';
import {
  createHttpResponse,
  createHttpResponseStart,
  createHttpResponseChunk,
  createHttpResponseEnd,
  filterHeaders,
} from '@arturious/web-socket-tunnel-protocol';

export function createLocalForwarder({ host, port, log = console.log }) {
  function buildOptions(httpRequest) {
    const { method, url, headers, body, bodyEncoding } = httpRequest;
    const requestBody = body
      ? Buffer.from(body, bodyEncoding || 'utf8')
      : null;

    return {
      options: {
        host,
        port,
        path: url,
        method,
        headers: {
          ...filterHeaders(headers),
          ...(requestBody ? { 'content-length': requestBody.length } : {}),
        },
      },
      requestBody,
    };
  }

  // Single-shot forwarder (buffers the whole response). Kept for protocol
  // compatibility with servers that only understand HTTP_RESPONSE.
  function forwardRequestToLocal(httpRequest) {
    const { options, requestBody } = buildOptions(httpRequest);

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
        res.on('error', (error) => {
          log('local response failed:', error.message);
          resolve(
            createHttpResponse({
              id: httpRequest.id,
              status: 502,
              headers: { 'Content-Type': 'text/plain' },
              body: Buffer.from('local response failed: ' + error.message).toString('base64'),
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

  // Streaming forwarder: emits a start event for headers, a chunk event for
  // each body chunk, and an end event when the response finishes.
  function forwardRequestToLocalStream(httpRequest, events) {
    const { options, requestBody } = buildOptions(httpRequest);

    const req = http.request(options, (res) => {
      events.onStart?.(res.statusCode || 200, filterHeaders(res.headers));
      res.on('data', (chunk) => events.onChunk?.(chunk));
      res.on('end', () => events.onEnd?.());
      // A mid-stream error means the local response was truncated; terminate
      // the stream so the server closes the browser connection cleanly.
      res.on('error', (error) => {
        log('local response failed:', error.message);
        events.onEnd?.();
      });
    });

    req.on('error', (error) => {
      log('local request failed:', error.message);
      events.onError?.(error);
    });

    if (requestBody) {
      req.write(requestBody);
    }
    req.end();
  }

  return { forwardRequestToLocal, forwardRequestToLocalStream };
}

export {
  createHttpResponse,
  createHttpResponseStart,
  createHttpResponseChunk,
  createHttpResponseEnd,
};