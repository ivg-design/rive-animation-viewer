# RAV anonymous installation counter

This directory is the minimal public endpoint for RAV's opt-out installation counter. It accepts the Rust client's `install`, `monthly_active`, and one final `telemetry_off` status update for each on-to-off preference change at `POST /v1/event`, and publishes only the aggregate installation total at `GET /v1/stats`.

The Worker:

- caps request bodies at 2 KiB and validates exact fields and formats;
- transforms the existing random 128-bit anonymous install token with domain-separated HMAC-SHA-256 before D1 storage;
- stores only event type, month where applicable, HMAC digest, release, receipt time, an opaque enabled/disabled installation status, and its monotonic preference generation;
- inspects only content type/length and the bounded, allowlisted JSON payload, without persisting raw bodies or request metadata;
- contains no `console` logging and disables Worker observability and invocation logs in `wrangler.jsonc`;
- responds identically (`204`) to accepted, duplicate, and stale well-formed events; D1 deduplicates aggregates and rejects stale generations without creating a preference-state oracle;
- applies a fail-closed, per-Cloudflare-location write cap before D1 and exposes a read-only `GET /v1/health` deployment probe;
- increments identifier-free aggregate counters through SQLite triggers; a final `telemetry_off` receipt also creates its deduplicated install entry if the initial install report never arrived. Event-token digests are opportunistically deleted after 90 days, while the opaque opt-out status remains durable.
- returns the installation aggregate through the enabled 60-second Worker cache; it never exposes release cohorts or row-level digests.

Cloudflare necessarily processes connection metadata to deliver the request. Confirm that account-level Logpush, Tail Workers, WAF/security-event retention, and any external tracing are disabled or configured consistently; the Worker configuration controls Workers observability, not every account-level Cloudflare product.

These are best-effort product metrics, not an authentication or billing ledger. A public desktop client cannot keep an anti-forgery secret, and Cloudflare's Worker rate limits are permissive and local to each Cloudflare location.

## Request schema

Install:

```json
{"schema":2,"event":"install","token":"Abcdefghijklmnopqrstu_","release":"2.5.2","preferenceGeneration":1,"establishInstall":true}
```

Monthly activity:

```json
{"schema":2,"event":"monthly_active","token":"Abcdefghijklmnopqrstu_","release":"2.5.2","preferenceGeneration":1,"period":"2026-08"}
```

Telemetry disabled (sent once when the user changes anonymous usage from on to off):

```json
{"schema":2,"event":"telemetry_off","token":"Abcdefghijklmnopqrstu_","release":"2.5.2","preferenceGeneration":2,"status":"disabled","establishInstall":false}
```

Tokens are exactly 22 unpadded base64url characters (128 bits). Schema v2 uses the same existing anonymous token for all three events, so ordering does not add another identifier. The Worker computes an install-domain digest for durable preference state and a separate month-domain digest for monthly deduplication, then discards the raw token. It stores neither request metadata nor a second client identity.

`preferenceGeneration` is a non-negative JSON-safe integer persisted by the app and incremented on every actual on/off transition. The Worker changes an install's status only when the incoming generation is greater than the stored generation. A v2 monthly event is inserted only when its generation exactly matches a currently enabled status row. Therefore an install or monthly request that finishes after a newer `telemetry_off` cannot re-enable the installation or add monthly activity. A later explicit re-enable increments the generation again; its `install` event supersedes the disabled state. Equal-generation retries and lower-generation delayed requests return `204` but do not change status or duplicate aggregates.

`establishInstall` is present on schema-v2 `install` and `telemetry_off`, and is true only while the client has no durable acknowledgement that its one aggregate was established. It lets an off receipt win the install-start/off race while creating the aggregate exactly once. It is false for an acknowledged or legacy install, so an upgraded legacy client can create its missing enabled status row before monthly activity without recounting under its replacement token. Retry, re-enable, and expired event digests likewise cannot recount the installation. Failed off delivery remains durable locally and is retried with the same token and generation. The app sends no other events while disabled. `monthly_active.period` must be a valid UTC month within one month of the Worker's current UTC month. Unknown fields are rejected. Released schema-v1 install/monthly payloads remain accepted at implicit generation zero; schema v1 cannot send `telemetry_off`.

## Test locally

No package installation is required for the focused unit tests:

```bash
cd telemetry/worker
npm test
```

The tests use both a D1-shaped call recorder and real in-memory SQLite. They verify the two out-of-order disable races, re-enable, retries, legacy compatibility, aggregate idempotency, and that raw tokens/request metadata never reach bound SQL values.

## Prepare a deployment

These commands are documentation only; this repository does not deploy automatically.

1. Create D1 and copy its ID into `wrangler.jsonc`:

   ```bash
   npx wrangler@4 d1 create rav-anonymous-counter
   ```

2. Apply the schema for a new database, or both existing-database migrations in order before deploying the schema-v2 Worker:

   ```bash
   npx wrangler@4 d1 execute rav-anonymous-counter --remote --file=schema.sql
   ```

   Existing database:

   ```bash
   npx wrangler@4 d1 execute rav-anonymous-counter --remote \
     --file=migrations/0003_install_status.sql
   npx wrangler@4 d1 execute rav-anonymous-counter --remote \
     --file=migrations/0004_preference_generation.sql
   ```

   Migration `0004_preference_generation.sql` is a one-time `ALTER TABLE`; do not rerun it after it succeeds. It assigns generation zero to existing status rows.

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

Currently disabled anonymous installations (private; never exposed by `/v1/stats`):

```sql
SELECT COUNT(*) AS telemetry_disabled
FROM anonymous_install_status
WHERE status = 'disabled';
```

Execute a query without exporting row-level digests:

```bash
npx wrangler@4 d1 execute rav-anonymous-counter --remote \
  --command="SELECT period, SUM(total) AS active_installations FROM anonymous_counts WHERE event_type = 'monthly_active' GROUP BY period ORDER BY period DESC;"
```

These are approximate counts of reporting app installations, not people, accounts, or physical devices. The public endpoint exposes only the total installation aggregate; avoid publishing small release cohorts from manual database queries.
