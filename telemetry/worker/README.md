# RAV anonymous installation counter

This directory is the minimal public endpoint for RAV's opt-out installation counter. It accepts only the Rust client's `install` and `monthly_active` payloads at `POST /v1/event` and publishes only the aggregate installation total at `GET /v1/stats`.

The Worker:

- caps request bodies at 2 KiB and validates exact fields and formats;
- transforms the random client token with domain-separated HMAC-SHA-256 before D1 storage;
- stores only event type, month where applicable, HMAC digest, release, and receipt time;
- inspects only content type/length and the bounded, allowlisted JSON payload, without persisting raw bodies or request metadata;
- contains no `console` logging and disables Worker observability and invocation logs in `wrangler.jsonc`;
- responds identically to a new event and a duplicate (`204`) because D1 uses `INSERT OR IGNORE`;
- applies a fail-closed, per-Cloudflare-location write cap before D1 and exposes a read-only `GET /v1/health` deployment probe;
- increments identifier-free aggregate counters through a SQLite trigger and deletes event-token digests after 90 days; aggregate counts remain.
- returns the installation aggregate through the enabled 60-second Worker cache; it never exposes release cohorts or row-level digests.

Cloudflare necessarily processes connection metadata to deliver the request. Confirm that account-level Logpush, Tail Workers, WAF/security-event retention, and any external tracing are disabled or configured consistently; the Worker configuration controls Workers observability, not every account-level Cloudflare product.

These are best-effort product metrics, not an authentication or billing ledger. A public desktop client cannot keep an anti-forgery secret, Cloudflare's Worker rate limits are permissive and local to each Cloudflare location, and a server-accepted request whose acknowledgement is lost can count again after its 90-day deduplication digest expires.

## Request schema

Install:

```json
{"schema":1,"event":"install","token":"Abcdefghijklmnopqrstu_","release":"2.4.4"}
```

Monthly activity:

```json
{"schema":1,"event":"monthly_active","token":"Zbcdefghijklmnopqrstu-","release":"2.4.4","period":"2026-08"}
```

Tokens are exactly 22 unpadded base64url characters (128 bits). `monthly_active.period` must be a valid UTC month within one month of the Worker's current UTC month. Unknown fields are rejected.

## Test locally

No package installation is required for the focused unit tests:

```bash
cd telemetry/worker
npm test
```

The tests use an in-memory D1-shaped stub and verify that raw tokens and request metadata never reach bound SQL values.

## Prepare a deployment

These commands are documentation only; this repository does not deploy automatically.

1. Create D1 and copy its ID into `wrangler.jsonc`:

   ```bash
   npx wrangler@4 d1 create rav-anonymous-counter
   ```

2. Apply the schema:

   ```bash
   npx wrangler@4 d1 execute rav-anonymous-counter --remote --file=schema.sql
   ```

3. Generate and store a server-only pepper. Never put it in `vars`, source control, CI output, or the RAV client:

   ```bash
   openssl rand -base64 48 | npx wrangler@4 secret put TOKEN_PEPPER
   ```

4. Confirm that `namespace_id` under `ratelimits` is unique within the Cloudflare account. The checked-in binding caps accepted writes at 120 per minute in each Cloudflare location. The checked-in Worker cache protects the aggregate D1 read path; use a current Wrangler 4 release (validated with 4.125.0).

5. Review account-level logging controls, then deploy. The default `workers.dev` endpoint is enabled for the fastest setup; a custom route can replace it later without changing the protocol:

   ```bash
   npx wrangler@4 deploy
   ```

6. Verify the secret and D1 schema through the non-mutating health route:

   ```bash
   curl --fail --silent --show-error --output /dev/null \
     https://YOUR-WORKER.workers.dev/v1/health
   ```

   Then verify the public aggregate route returns only `schema` and `installations`:

   ```bash
   curl --fail --silent --show-error \
     https://YOUR-WORKER.workers.dev/v1/stats
   ```

7. Create an account budget alert and, if available for the chosen hostname and plan, an additional account-level WAF rule. Budget alerts notify; they do not stop usage. Then set the GitHub repository variable `RAV_COUNTER_ENDPOINT` to the credential-free HTTPS `.../v1/event` URL. The release workflow probes `/v1/health` before it creates a draft and passes that one canonical endpoint to every platform build.

Cloudflare's current Worker configuration and D1 binding references are:

- <https://developers.cloudflare.com/workers/wrangler/configuration/>
- <https://developers.cloudflare.com/workers/cache/configuration/>
- <https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/>
- <https://developers.cloudflare.com/d1/worker-api/>
- <https://developers.cloudflare.com/workers/runtime-apis/web-crypto/>
- <https://developers.cloudflare.com/billing/manage/budget-alerts/>

## Aggregate queries

Total accepted installation reports (identifier-free aggregate):

```sql
SELECT SUM(total) AS installs
FROM anonymous_counts
WHERE event_type = 'install';
```

Install reports by release:

```sql
SELECT release, SUM(total) AS installs
FROM anonymous_counts
WHERE event_type = 'install'
GROUP BY release
ORDER BY installs DESC;
```

Monthly active installations:

```sql
SELECT period, SUM(total) AS active_installations
FROM anonymous_counts
WHERE event_type = 'monthly_active'
GROUP BY period
ORDER BY period DESC;
```

Execute a query without exporting row-level digests:

```bash
npx wrangler@4 d1 execute rav-anonymous-counter --remote \
  --command="SELECT period, SUM(total) AS active_installations FROM anonymous_counts WHERE event_type = 'monthly_active' GROUP BY period ORDER BY period DESC;"
```

These are approximate counts of reporting app installations, not people, accounts, or physical devices. The public endpoint exposes only the total installation aggregate; avoid publishing small release cohorts from manual database queries.
