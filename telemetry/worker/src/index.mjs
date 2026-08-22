const EVENT_PATH = '/v1/event';
const HEALTH_PATH = '/v1/health';
const MAX_BODY_BYTES = 2_048;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const RELEASE_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?(?:\+[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/;
const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const ENCODER = new TextEncoder();

const INSERT_EVENT_SQL = `
  INSERT OR IGNORE INTO anonymous_events
    (event_type, period, token_digest, release, received_at)
  VALUES (?, ?, ?, ?, ?)
`;
const DELETE_EXPIRED_DIGESTS_SQL = `
  DELETE FROM anonymous_events
  WHERE received_at < ?
`;
const DIGEST_RETENTION_DAYS = 90;
const HEALTH_SQL = 'SELECT COUNT(*) AS total FROM anonymous_counts';
const GLOBAL_WRITE_LIMIT_KEY = 'rav-counter:v1:global';

class RequestError extends Error {
  constructor(status) {
    super('request rejected');
    this.status = status;
  }
}

function response(status, body = null, extraHeaders = {}) {
  const headers = new Headers({
    'cache-control': 'no-store',
    ...extraHeaders,
  });
  if (body !== null) {
    headers.set('content-type', 'text/plain; charset=utf-8');
  }
  return new Response(body, { status, headers });
}

function exactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

function utcPeriod(date, offsetMonths = 0) {
  const shifted = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth() + offsetMonths,
    1,
  ));
  return `${shifted.getUTCFullYear().toString().padStart(4, '0')}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}

function periodIsNearCurrent(period, now) {
  return [-1, 0, 1].some((offset) => period === utcPeriod(now, offset));
}

export function validateEventPayload(value, now = new Date()) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RequestError(400);
  }
  if (value.schema !== 1 || !['install', 'monthly_active'].includes(value.event)) {
    throw new RequestError(400);
  }
  if (typeof value.token !== 'string' || !TOKEN_PATTERN.test(value.token)) {
    throw new RequestError(400);
  }
  if (
    typeof value.release !== 'string'
    || value.release.length > 64
    || !RELEASE_PATTERN.test(value.release)
  ) {
    throw new RequestError(400);
  }

  if (value.event === 'install') {
    if (!exactKeys(value, ['schema', 'event', 'token', 'release'])) {
      throw new RequestError(400);
    }
    return {
      event: value.event,
      period: '',
      release: value.release,
      token: value.token,
    };
  }

  if (
    !exactKeys(value, ['schema', 'event', 'token', 'release', 'period'])
    || typeof value.period !== 'string'
    || !PERIOD_PATTERN.test(value.period)
    || !periodIsNearCurrent(value.period, now)
  ) {
    throw new RequestError(400);
  }
  return {
    event: value.event,
    period: value.period,
    release: value.release,
    token: value.token,
  };
}

async function readBoundedBody(request) {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) {
      throw new RequestError(400);
    }
    if (Number(declaredLength) > MAX_BODY_BYTES) {
      throw new RequestError(413);
    }
  }
  if (!request.body) {
    throw new RequestError(400);
  }

  const reader = request.body.getReader();
  const chunks = [];
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new RequestError(413);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new RequestError(400);
  }
}

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function digestToken({ event, period, token }, pepper, subtle = globalThis.crypto?.subtle) {
  if (typeof pepper !== 'string' || ENCODER.encode(pepper).byteLength < 32 || !subtle) {
    throw new Error('counter storage is unavailable');
  }
  const key = await subtle.importKey(
    'raw',
    ENCODER.encode(pepper),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const domainSeparatedValue = `rav-counter:v1\0${event}\0${period}\0${token}`;
  const digest = await subtle.sign('HMAC', key, ENCODER.encode(domainSeparatedValue));
  return toHex(digest);
}

async function storeEvent(database, event, digest, receivedAt) {
  if (!database?.prepare) {
    throw new Error('counter storage is unavailable');
  }
  const result = await database
    .prepare(INSERT_EVENT_SQL)
    .bind(event.event, event.period, digest, event.release, receivedAt)
    .run();
  if (result?.success === false) {
    throw new Error('counter storage is unavailable');
  }
  const retentionCutoff = new Date(
    new Date(receivedAt).getTime() - DIGEST_RETENTION_DAYS * 24 * 60 * 60 * 1_000,
  ).toISOString();
  const cleanup = await database
    .prepare(DELETE_EXPIRED_DIGESTS_SQL)
    .bind(retentionCutoff)
    .run();
  if (cleanup?.success === false) {
    throw new Error('counter storage is unavailable');
  }
}

async function storageIsHealthy(env) {
  if (
    typeof env?.TOKEN_PEPPER !== 'string'
    || ENCODER.encode(env.TOKEN_PEPPER).byteLength < 32
    || !env?.DB?.prepare
    || typeof env?.WRITE_RATE_LIMITER?.limit !== 'function'
  ) {
    return false;
  }
  const result = await env.DB.prepare(HEALTH_SQL).first();
  return Number.isInteger(result?.total) && result.total >= 0;
}

async function writeIsAllowed(env) {
  if (typeof env?.WRITE_RATE_LIMITER?.limit !== 'function') {
    throw new Error('counter rate limit is unavailable');
  }
  const result = await env.WRITE_RATE_LIMITER.limit({ key: GLOBAL_WRITE_LIMIT_KEY });
  return result?.success === true;
}

export async function handleRequest(request, env, {
  now = () => new Date(),
  subtle = globalThis.crypto?.subtle,
} = {}) {
  try {
    const url = new URL(request.url);
    if (url.pathname === HEALTH_PATH && url.search === '') {
      if (request.method !== 'GET') {
        return response(405, 'method not allowed', { allow: 'GET' });
      }
      return (await storageIsHealthy(env)) ? response(204) : response(503, 'service unavailable');
    }
    if (url.pathname !== EVENT_PATH || url.search !== '') {
      return response(404, 'not found');
    }
    if (request.method !== 'POST') {
      return response(405, 'method not allowed', { allow: 'POST' });
    }
    const mediaType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
    if (mediaType !== 'application/json') {
      return response(415, 'unsupported media type');
    }

    const body = await readBoundedBody(request);
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new RequestError(400);
    }

    const received = now();
    const event = validateEventPayload(parsed, received);
    const digest = await digestToken(event, env?.TOKEN_PEPPER, subtle);
    if (!(await writeIsAllowed(env))) {
      return response(429, 'too many requests', { 'retry-after': '60' });
    }
    await storeEvent(env?.DB, event, digest, received.toISOString());
    return response(204);
  } catch (error) {
    if (error instanceof RequestError) {
      return response(error.status, error.status === 413 ? 'payload too large' : 'invalid request');
    }
    return response(503, 'service unavailable');
  }
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
};
