import test from 'node:test';
import assert from 'node:assert/strict';

import { createLogger } from '../src/logger.js';

test('createLogger returns a callable logger with leveled methods', () => {
  const log = createLogger('test', 'debug');
  assert.equal(typeof log, 'function');
  assert.equal(typeof log.debug, 'function');
  assert.equal(typeof log.info, 'function');
  assert.equal(typeof log.warn, 'function');
  assert.equal(typeof log.error, 'function');

  // Calling the logger directly must not throw (regression test for
  // "log is not a function" when passed to local-forward).
  assert.doesNotThrow(() => log('hello', 'world'));
});