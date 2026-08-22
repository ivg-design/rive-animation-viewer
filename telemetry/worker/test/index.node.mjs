import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  digestToken,
  handleRequest,
  validateEventPayload,
} from '../src/index.mjs';

const NOW = new Date('2026-08-21T12:00:00.000Z');
const PEPPER = 'test-only-pepper-that-is-at-least-32-bytes-long';
const INSTALL_TOKEN = 'Abcdefghijklmnopqrstu_';
const ACTIVE_TOKEN = 'Zbcdefghijklmnopqrstu-';

function jsonRequest(payload, options = {}) {
  return new Request(options.url || 'https://counter.example/v1/event', {
    method: options.method || 'POST',
    headers: {
      'content-type': options.contentType || 'application/json',
      ...(options.headers || {}),
    },
    body: options.body === undefined ? JSON.stringify(payload) : options.body,
  });
}

function fakeDatabase({ fail = false } = {}) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        async first() {
          calls.push({ sql, values: [] });
          if (fail) throw new Error('private database error');
          return { total: 0 };
        },
        bind(...values) {
          calls.push({ sql, values });
          return {
            async run() {
              if (fail) throw new Error('private database error');
              return { success: true };
            },
          };
        },
      };
    },
  };
}

function environment(database = fakeDatabase(), { rateLimitAllows = true } = {}) {
  return {
    DB: database,
    TOKEN_PEPPER: PEPPER,
    WRITE_RATE_LIMITER: {
      async limit() {
        return { success: rateLimitAllows };
      },
    },
  };
}

describe('payload validation', () => {
  it('accepts the exact Rust install and monthly-active contracts', () => {
    assert.deepEqual(validateEventPayload({
      schema: 1,
      event: 'install',
      token: INSTALL_TOKEN,
      release: '2.4.4',
    }, NOW), {
      event: 'install',
      period: '',
      release: '2.4.4',
      token: INSTALL_TOKEN,
    });

    assert.equal(validateEventPayload({
      schema: 1,
      event: 'monthly_active',
      token: ACTIVE_TOKEN,
      release: '2.4.4',
      period: '2026-08',
    }, NOW).period, '2026-08');
  });

  it('rejects unknown fields, malformed tokens, releases, and distant periods', () => {
    const invalid = [
      { schema: 1, event: 'install', token: INSTALL_TOKEN, release: '2.4.3', extra: true },
      { schema: 1, event: 'install', token: 'too-short', release: '2.4.3' },
      { schema: 1, event: 'install', token: INSTALL_TOKEN, release: '../2.4.3' },
      { schema: 1, event: 'monthly_active', token: ACTIVE_TOKEN, release: '2.4.3', period: '2024-01' },
    ];
    for (const payload of invalid) {
      assert.throws(() => validateEventPayload(payload, NOW));
    }
  });
});

describe('privacy-preserving storage', () => {
  it('HMACs with domain separation before writing and never binds raw request data', async () => {
    const database = fakeDatabase();
    const request = jsonRequest({
      schema: 1,
      event: 'monthly_active',
      token: ACTIVE_TOKEN,
      release: '2.4.4',
      period: '2026-08',
    }, {
      headers: {
        'cf-connecting-ip': '203.0.113.10',
        'user-agent': 'sensitive-test-agent',
      },
    });

    const result = await handleRequest(request, environment(database), { now: () => NOW });
    assert.equal(result.status, 204);
    assert.equal(database.calls.length, 2);
    const [{ values }, cleanup] = database.calls;
    assert.equal(values[0], 'monthly_active');
    assert.equal(values[1], '2026-08');
    assert.match(values[2], /^[0-9a-f]{64}$/);
    assert.equal(values[3], '2.4.4');
    assert.equal(values[4], NOW.toISOString());
    assert.ok(!values.includes(ACTIVE_TOKEN));
    assert.ok(!values.includes('203.0.113.10'));
    assert.ok(!values.includes('sensitive-test-agent'));
    assert.match(cleanup.sql, /DELETE FROM anonymous_events/);
    assert.equal(cleanup.values.length, 1);
  });

  it('produces stable dedupe digests and separates event domains', async () => {
    const install = { event: 'install', period: '', token: INSTALL_TOKEN };
    const first = await digestToken(install, PEPPER);
    assert.equal(first, await digestToken(install, PEPPER));
    assert.notEqual(first, await digestToken({
      event: 'monthly_active',
      period: '2026-08',
      token: INSTALL_TOKEN,
    }, PEPPER));
  });
});

describe('HTTP boundary', () => {
  it('exposes a read-only health probe only when storage and the server secret are ready', async () => {
    const ready = await handleRequest(
      new Request('https://counter.example/v1/health'),
      environment(),
    );
    assert.equal(ready.status, 204);

    const unavailable = await handleRequest(
      new Request('https://counter.example/v1/health'),
      { DB: fakeDatabase(), TOKEN_PEPPER: 'short', WRITE_RATE_LIMITER: { limit() {} } },
    );
    assert.equal(unavailable.status, 503);
    assert.equal(unavailable.headers.get('cache-control'), 'no-store');
  });

  it('fails closed before D1 writes when the global write budget is exhausted', async () => {
    const database = fakeDatabase();
    const result = await handleRequest(jsonRequest({
      schema: 1,
      event: 'install',
      token: INSTALL_TOKEN,
      release: '2.4.4',
    }), environment(database, { rateLimitAllows: false }), { now: () => NOW });

    assert.equal(result.status, 429);
    assert.equal(result.headers.get('retry-after'), '60');
    assert.equal(database.calls.length, 0);
  });

  it('rejects oversized, malformed, wrong-content-type, and wrong-route requests', async () => {
    const env = environment();
    const oversized = jsonRequest(null, { body: 'x'.repeat(2_049) });
    assert.equal((await handleRequest(oversized, env, { now: () => NOW })).status, 413);
    assert.equal((await handleRequest(
      jsonRequest(null, { body: '{' }),
      env,
      { now: () => NOW },
    )).status, 400);
    assert.equal((await handleRequest(
      jsonRequest({}, { contentType: 'text/plain' }),
      env,
      { now: () => NOW },
    )).status, 415);
    assert.equal((await handleRequest(
      jsonRequest({}, { url: 'https://counter.example/other' }),
      env,
      { now: () => NOW },
    )).status, 404);
  });

  it('returns generic no-store failures without exposing storage details', async () => {
    const database = fakeDatabase({ fail: true });
    const result = await handleRequest(jsonRequest({
      schema: 1,
      event: 'install',
      token: INSTALL_TOKEN,
      release: '2.4.4',
    }), environment(database), { now: () => NOW });

    assert.equal(result.status, 503);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.equal(await result.text(), 'service unavailable');
  });
});
