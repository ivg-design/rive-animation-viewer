import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
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
const SCHEMA_SQL = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
const SCHEMA_V1_SQL = readFileSync(new URL('./schema-v1.sql', import.meta.url), 'utf8');
const MIGRATION_0003_SQL = readFileSync(
  new URL('../migrations/0003_install_status.sql', import.meta.url),
  'utf8',
);
const MIGRATION_0004_SQL = readFileSync(
  new URL('../migrations/0004_preference_generation.sql', import.meta.url),
  'utf8',
);

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

function fakeDatabase({
  fail = false,
  installTotal = 0,
  missingInstallStatusTable = false,
  missingPreferenceGeneration = false,
} = {}) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      return {
        async first() {
          calls.push({ sql, values: [] });
          if (fail) throw new Error('private database error');
          if (missingInstallStatusTable && sql.includes('anonymous_install_status')) {
            throw new Error('no such table: anonymous_install_status');
          }
          if (missingPreferenceGeneration && sql.includes('preference_generation')) {
            throw new Error('no such column: preference_generation');
          }
          if (sql.includes("event_type = 'install'")) return { total: installTotal };
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

function sqliteDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(SCHEMA_SQL);
  return {
    sqlite,
    prepare(sql) {
      return {
        async first() {
          return sqlite.prepare(sql).get();
        },
        bind(...values) {
          return {
            async run() {
              sqlite.prepare(sql).run(...values);
              return { success: true };
            },
          };
        },
      };
    },
  };
}

function interleavingSqliteDatabase() {
  const database = sqliteDatabase();
  const prepare = database.prepare.bind(database);
  let aggregateInsertArrivals = 0;
  let releaseAggregateInserts;
  const bothAggregateInsertsRan = new Promise((resolve) => {
    releaseAggregateInserts = resolve;
  });
  database.prepare = (sql) => {
    const statement = prepare(sql);
    return {
      first: statement.first,
      bind(...values) {
        const bound = statement.bind(...values);
        return {
          async run() {
            const result = await bound.run();
            if (sql.includes('WHERE NOT EXISTS')) {
              aggregateInsertArrivals += 1;
              if (aggregateInsertArrivals === 2) {
                releaseAggregateInserts();
              } else {
                await bothAggregateInsertsRan;
              }
            }
            return result;
          },
        };
      },
    };
  };
  return database;
}

describe('production schema migration', () => {
  it('upgrades the released schema in order without losing aggregate data', () => {
    const sqlite = new DatabaseSync(':memory:');
    sqlite.exec(SCHEMA_V1_SQL);
    sqlite.prepare(`
      INSERT INTO anonymous_events
        (event_type, period, token_digest, release, received_at)
      VALUES ('install', '', ?, '2.5.1', '2026-08-22T00:00:00.000Z')
    `).run('a'.repeat(64));

    sqlite.exec(MIGRATION_0003_SQL);
    sqlite.prepare(`
      INSERT INTO anonymous_install_status
        (token_digest, status, release, updated_at)
      VALUES (?, 'enabled', '2.5.1', '2026-08-22T00:00:00.000Z')
    `).run('b'.repeat(64));
    sqlite.exec(MIGRATION_0004_SQL);

    assert.equal(
      sqlite.prepare("SELECT SUM(total) AS total FROM anonymous_counts WHERE event_type = 'install'")
        .get().total,
      1,
    );
    const migratedStatus = sqlite
      .prepare('SELECT status, preference_generation FROM anonymous_install_status')
      .get();
    assert.equal(migratedStatus.status, 'enabled');
    assert.equal(migratedStatus.preference_generation, 0);
    assert.doesNotThrow(() => sqlite.exec(MIGRATION_0003_SQL));
  });
});

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
  it('accepts the exact Rust install, monthly-active, and telemetry-off contracts', () => {
    assert.deepEqual(validateEventPayload({
      schema: 2,
      event: 'install',
      token: INSTALL_TOKEN,
      release: '2.5.0',
      preferenceGeneration: 1,
      establishInstall: true,
    }, NOW), {
      event: 'install',
      establishInstall: true,
      period: '',
      preferenceGeneration: 1,
      release: '2.5.0',
      schema: 2,
      token: INSTALL_TOKEN,
    });

    assert.equal(validateEventPayload({
      schema: 2,
      event: 'monthly_active',
      token: ACTIVE_TOKEN,
      release: '2.5.0',
      period: '2026-08',
      preferenceGeneration: 1,
    }, NOW).period, '2026-08');

    assert.deepEqual(validateEventPayload({
      schema: 2,
      event: 'telemetry_off',
      token: INSTALL_TOKEN,
      release: '2.5.0',
      preferenceGeneration: 2,
      status: 'disabled',
      establishInstall: true,
    }, NOW), {
      event: 'telemetry_off',
      establishInstall: true,
      period: '',
      preferenceGeneration: 2,
      release: '2.5.0',
      schema: 2,
      status: 'disabled',
      token: INSTALL_TOKEN,
    });
  });

  it('rejects unknown fields, malformed tokens, releases, and distant periods', () => {
    const invalid = [
      { schema: 1, event: 'install', token: INSTALL_TOKEN, release: '2.4.3', extra: true },
      { schema: 1, event: 'install', token: 'too-short', release: '2.4.3' },
      { schema: 1, event: 'install', token: INSTALL_TOKEN, release: '../2.4.3' },
      { schema: 1, event: 'monthly_active', token: ACTIVE_TOKEN, release: '2.4.3', period: '2024-01' },
      { schema: 1, event: 'telemetry_off', token: INSTALL_TOKEN, release: '2.4.3', period: '2026-08', status: 'disabled' },
      { schema: 1, event: 'telemetry_off', token: INSTALL_TOKEN, release: '2.4.3' },
      { schema: 1, event: 'telemetry_off', token: INSTALL_TOKEN, release: '2.4.3', status: 'enabled' },
      { schema: 2, event: 'install', token: INSTALL_TOKEN, release: '2.5.0', preferenceGeneration: -1, establishInstall: true },
      { schema: 2, event: 'install', token: INSTALL_TOKEN, release: '2.5.0', preferenceGeneration: 1.5, establishInstall: true },
      { schema: 2, event: 'install', token: INSTALL_TOKEN, release: '2.5.0', preferenceGeneration: Number.MAX_SAFE_INTEGER + 1, establishInstall: true },
      { schema: 2, event: 'install', token: INSTALL_TOKEN, release: '2.5.0', preferenceGeneration: 1 },
      { schema: 2, event: 'monthly_active', token: INSTALL_TOKEN, release: '2.5.0', period: '2026-08' },
      { schema: 2, event: 'telemetry_off', token: INSTALL_TOKEN, release: '2.5.0', preferenceGeneration: 2, status: 'disabled' },
      { schema: 2, event: 'telemetry_off', token: INSTALL_TOKEN, release: '2.5.0', preferenceGeneration: 2, status: 'disabled', establishInstall: 'yes' },
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
      schema: 2,
      event: 'monthly_active',
      token: INSTALL_TOKEN,
      release: '2.5.0',
      period: '2026-08',
      preferenceGeneration: 1,
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
    assert.equal(values[3], '2.5.0');
    assert.equal(values[4], NOW.toISOString());
    assert.ok(!values.includes(INSTALL_TOKEN));
    assert.ok(!values.includes('203.0.113.10'));
    assert.ok(!values.includes('sensitive-test-agent'));
    assert.match(cleanup.sql, /DELETE FROM anonymous_events/);
    assert.equal(cleanup.values.length, 1);
  });

  it('produces stable dedupe digests and maps telemetry-off to the install identity', async () => {
    const install = { event: 'install', period: '', token: INSTALL_TOKEN };
    const first = await digestToken(install, PEPPER);
    assert.equal(first, await digestToken(install, PEPPER));
    assert.notEqual(first, await digestToken({
      event: 'monthly_active',
      period: '2026-08',
      token: INSTALL_TOKEN,
    }, PEPPER));
    assert.equal(first, await digestToken({
      event: 'install',
      period: '',
      token: INSTALL_TOKEN,
    }, PEPPER));
  });

  it('counts an otherwise-unreported installation and records it disabled on telemetry-off', async () => {
    const database = fakeDatabase();
    const result = await handleRequest(jsonRequest({
      schema: 2,
      event: 'telemetry_off',
      token: INSTALL_TOKEN,
      release: '2.5.0',
      preferenceGeneration: 2,
      status: 'disabled',
      establishInstall: true,
    }, {
      headers: {
        'cf-connecting-ip': '203.0.113.11',
        'user-agent': 'sensitive-opt-out-agent',
      },
    }), environment(database), { now: () => NOW });

    assert.equal(result.status, 204);
    assert.equal(database.calls.length, 3);
    const [installWrite, statusWrite, eventCleanup] = database.calls;
    const installDigest = await digestToken({ event: 'install', period: '', token: INSTALL_TOKEN }, PEPPER);
    assert.match(installWrite.sql, /INSERT OR IGNORE INTO anonymous_events/);
    assert.match(installWrite.sql, /NOT EXISTS/);
    assert.deepEqual(installWrite.values.slice(0, 2), ['install', '']);
    assert.equal(installWrite.values[2], installDigest);
    assert.equal(installWrite.values.at(-1), installDigest);
    assert.match(statusWrite.sql, /anonymous_install_status/);
    assert.equal(statusWrite.values.length, 5);
    assert.equal(statusWrite.values[0], installDigest);
    assert.equal(statusWrite.values[1], 'disabled');
    assert.equal(statusWrite.values[2], 2);
    assert.equal(statusWrite.values[3], '2.5.0');
    assert.equal(statusWrite.values[4], NOW.toISOString());
    for (const { values } of database.calls) {
      assert.ok(!values.includes(INSTALL_TOKEN));
      assert.ok(!values.includes('203.0.113.11'));
      assert.ok(!values.includes('sensitive-opt-out-agent'));
    }
    assert.match(eventCleanup.sql, /DELETE FROM anonymous_events/);
    assert.doesNotMatch(eventCleanup.sql, /anonymous_install_status/);
  });

  it('marks the same installation enabled again on an install receipt', async () => {
    const database = fakeDatabase();
    const result = await handleRequest(jsonRequest({
      schema: 2,
      event: 'install',
      token: INSTALL_TOKEN,
      release: '2.5.0',
      preferenceGeneration: 3,
      establishInstall: false,
    }), environment(database), { now: () => NOW });

    assert.equal(result.status, 204);
    assert.equal(database.calls.filter(({ sql }) => /INSERT OR IGNORE INTO anonymous_events/.test(sql)).length, 0);
    const statusWrite = database.calls.find(({ sql }) => /INSERT INTO anonymous_install_status/.test(sql));
    assert.deepEqual(statusWrite.values.slice(1), ['enabled', 3, '2.5.0', NOW.toISOString()]);
    assert.ok(!statusWrite.values.includes(INSTALL_TOKEN));
  });
});

describe('monotonic preference ordering', () => {
  async function send(database, payload, at) {
    const result = await handleRequest(
      jsonRequest(payload),
      environment(database),
      { now: () => new Date(at) },
    );
    assert.equal(result.status, 204);
  }

  function statusRow(database) {
    const row = database.sqlite.prepare(`
      SELECT status, preference_generation AS generation
      FROM anonymous_install_status
    `).get();
    return { status: row.status, generation: row.generation };
  }

  function eventTotal(database, event, period = '') {
    return database.sqlite.prepare(`
      SELECT COUNT(*) AS total
      FROM anonymous_events
      WHERE event_type = ? AND period = ?
    `).get(event, period).total;
  }

  function aggregateTotal(database, event, period = '') {
    return database.sqlite.prepare(`
      SELECT COALESCE(SUM(total), 0) AS total
      FROM anonymous_counts
      WHERE event_type = ? AND period = ?
    `).get(event, period).total;
  }

  it('keeps disable final when install-start -> off-complete -> install-complete arrives out of order', async () => {
    const database = sqliteDatabase();
    await send(database, {
      schema: 2,
      event: 'telemetry_off',
      token: INSTALL_TOKEN,
      release: '2.5.0',
      preferenceGeneration: 2,
      status: 'disabled',
      establishInstall: true,
    }, '2026-08-21T12:00:01.000Z');
    await send(database, {
      schema: 2,
      event: 'install',
      token: INSTALL_TOKEN,
      release: '2.5.0',
      preferenceGeneration: 1,
      establishInstall: true,
    }, '2026-08-21T12:00:02.000Z');

    assert.deepEqual(statusRow(database), { status: 'disabled', generation: 2 });
    assert.equal(eventTotal(database, 'install'), 1);
  });

  it('deduplicates when install and off aggregate inserts interleave before either status upsert', async () => {
    const database = interleavingSqliteDatabase();
    await Promise.all([
      send(database, {
        schema: 2,
        event: 'install',
        token: INSTALL_TOKEN,
        release: '2.5.0',
        preferenceGeneration: 1,
        establishInstall: true,
      }, '2026-08-21T12:00:00.000Z'),
      send(database, {
        schema: 2,
        event: 'telemetry_off',
        token: INSTALL_TOKEN,
        release: '2.5.0',
        preferenceGeneration: 2,
        status: 'disabled',
        establishInstall: true,
      }, '2026-08-21T12:00:01.000Z'),
    ]);

    assert.deepEqual(statusRow(database), { status: 'disabled', generation: 2 });
    assert.equal(eventTotal(database, 'install'), 1);
  });

  it('drops monthly-start -> off -> monthly-complete when the monthly generation is stale', async () => {
    const database = sqliteDatabase();
    await send(database, {
      schema: 2,
      event: 'install',
      token: INSTALL_TOKEN,
      release: '2.5.0',
      preferenceGeneration: 1,
      establishInstall: true,
    }, '2026-08-21T12:00:00.000Z');
    await send(database, {
      schema: 2,
      event: 'telemetry_off',
      token: INSTALL_TOKEN,
      release: '2.5.0',
      preferenceGeneration: 2,
      status: 'disabled',
      establishInstall: false,
    }, '2026-08-21T12:00:01.000Z');
    await send(database, {
      schema: 2,
      event: 'monthly_active',
      token: INSTALL_TOKEN,
      release: '2.5.0',
      preferenceGeneration: 1,
      period: '2026-08',
    }, '2026-08-21T12:00:02.000Z');

    assert.deepEqual(statusRow(database), { status: 'disabled', generation: 2 });
    assert.equal(eventTotal(database, 'monthly_active', '2026-08'), 0);
  });

  it('accepts explicit re-enable, ignores delayed off, and keeps retries idempotent', async () => {
    const database = sqliteDatabase();
    const disabled = {
      schema: 2,
      event: 'telemetry_off',
      token: INSTALL_TOKEN,
      release: '2.5.0',
      preferenceGeneration: 2,
      status: 'disabled',
      establishInstall: true,
    };
    const enabled = {
      schema: 2,
      event: 'install',
      token: INSTALL_TOKEN,
      release: '2.5.0',
      preferenceGeneration: 3,
      establishInstall: false,
    };
    const monthly = {
      schema: 2,
      event: 'monthly_active',
      token: INSTALL_TOKEN,
      release: '2.5.0',
      preferenceGeneration: 3,
      period: '2026-08',
    };

    await send(database, disabled, '2026-08-21T12:00:00.000Z');
    await send(database, disabled, '2026-08-21T12:00:01.000Z');
    await send(database, enabled, '2026-08-21T12:00:02.000Z');
    await send(database, disabled, '2026-08-21T12:00:03.000Z');
    await send(database, enabled, '2026-08-21T12:00:04.000Z');
    await send(database, monthly, '2026-08-21T12:00:05.000Z');
    await send(database, monthly, '2026-08-21T12:00:06.000Z');

    assert.deepEqual(statusRow(database), { status: 'enabled', generation: 3 });
    assert.equal(eventTotal(database, 'install'), 1);
    assert.equal(eventTotal(database, 'monthly_active', '2026-08'), 1);
  });

  it('keeps schema-v1 install/monthly compatibility at implicit generation zero', async () => {
    const database = sqliteDatabase();
    await send(database, {
      schema: 1,
      event: 'install',
      token: INSTALL_TOKEN,
      release: '2.5.0',
    }, '2026-08-21T12:00:00.000Z');
    await send(database, {
      schema: 1,
      event: 'monthly_active',
      token: ACTIVE_TOKEN,
      release: '2.5.0',
      period: '2026-08',
    }, '2026-08-21T12:00:01.000Z');

    assert.deepEqual(statusRow(database), { status: 'enabled', generation: 0 });
    assert.equal(eventTotal(database, 'install'), 1);
    assert.equal(eventTotal(database, 'monthly_active', '2026-08'), 1);
  });

  it('syncs a migrated enabled install, then off/re-enable, without recounting', async () => {
    const database = sqliteDatabase();
    // Production already contains this identifier-free aggregate, but the new
    // status table has no row for the legacy client's replacement token.
    database.sqlite.prepare(`
      INSERT INTO anonymous_counts (event_type, period, release, total)
      VALUES ('install', '', '2.4.4', 1)
    `).run();

    const statusSync = {
      schema: 2,
      event: 'install',
      token: INSTALL_TOKEN,
      release: '2.5.2',
      preferenceGeneration: 0,
      establishInstall: false,
    };
    await send(database, statusSync, '2026-08-21T12:00:00.000Z');
    await send(database, {
      schema: 2,
      event: 'monthly_active',
      token: INSTALL_TOKEN,
      release: '2.5.2',
      preferenceGeneration: 0,
      period: '2026-08',
    }, '2026-08-21T12:00:01.000Z');
    await send(database, {
      schema: 2,
      event: 'telemetry_off',
      token: INSTALL_TOKEN,
      release: '2.5.2',
      preferenceGeneration: 1,
      status: 'disabled',
      establishInstall: false,
    }, '2026-08-21T12:00:02.000Z');
    await send(database, {
      ...statusSync,
      preferenceGeneration: 2,
    }, '2026-08-21T12:00:03.000Z');

    assert.deepEqual(statusRow(database), { status: 'enabled', generation: 2 });
    assert.equal(aggregateTotal(database, 'install'), 1);
    assert.equal(eventTotal(database, 'monthly_active', '2026-08'), 1);
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

    const migrationMissing = await handleRequest(
      new Request('https://counter.example/v1/health'),
      environment(fakeDatabase({ missingInstallStatusTable: true })),
    );
    assert.equal(migrationMissing.status, 503);

    const generationMigrationMissing = await handleRequest(
      new Request('https://counter.example/v1/health'),
      environment(fakeDatabase({ missingPreferenceGeneration: true })),
    );
    assert.equal(generationMigrationMissing.status, 503);
  });

  it('publishes only the aggregate installation count with a one-minute cache', async () => {
    const result = await handleRequest(
      new Request('https://counter.example/v1/stats'),
      environment(fakeDatabase({ installTotal: 821 })),
    );
    assert.equal(result.status, 200);
    assert.equal(result.headers.get('access-control-allow-origin'), '*');
    assert.match(result.headers.get('cache-control'), /max-age=60/);
    assert.doesNotMatch(result.headers.get('cache-control'), /stale-while-revalidate/);
    assert.deepEqual(await result.json(), { schema: 1, installations: 821 });

    const wrongMethod = await handleRequest(
      new Request('https://counter.example/v1/stats', { method: 'POST' }),
      environment(),
    );
    assert.equal(wrongMethod.status, 405);
    assert.equal(wrongMethod.headers.get('allow'), 'GET');
  });

  it('fails closed before D1 writes when the global write budget is exhausted', async () => {
    const database = fakeDatabase();
    const result = await handleRequest(jsonRequest({
      schema: 1,
      event: 'install',
      token: INSTALL_TOKEN,
      release: '2.5.0',
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
      release: '2.5.0',
    }), environment(database), { now: () => NOW });

    assert.equal(result.status, 503);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.equal(await result.text(), 'service unavailable');
  });
});
