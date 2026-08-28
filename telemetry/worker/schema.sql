CREATE TABLE IF NOT EXISTS anonymous_events (
  event_type TEXT NOT NULL CHECK (event_type IN ('install', 'monthly_active')),
  period TEXT NOT NULL CHECK (
    (event_type = 'install' AND period = '')
    OR
    (event_type = 'monthly_active' AND length(period) = 7 AND substr(period, 5, 1) = '-')
  ),
  token_digest TEXT NOT NULL CHECK (
    length(token_digest) = 64
    AND token_digest NOT GLOB '*[^0-9a-f]*'
  ),
  release TEXT NOT NULL CHECK (length(release) BETWEEN 1 AND 64),
  received_at TEXT NOT NULL,
  PRIMARY KEY (event_type, period, token_digest)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS anonymous_events_period_release
  ON anonymous_events (event_type, period, release);

CREATE INDEX IF NOT EXISTS anonymous_events_received_at
  ON anonymous_events (received_at);

CREATE TABLE IF NOT EXISTS anonymous_counts (
  event_type TEXT NOT NULL CHECK (event_type IN ('install', 'monthly_active')),
  period TEXT NOT NULL,
  release TEXT NOT NULL CHECK (length(release) BETWEEN 1 AND 64),
  total INTEGER NOT NULL DEFAULT 0 CHECK (total >= 0),
  PRIMARY KEY (event_type, period, release)
) WITHOUT ROWID;

CREATE TRIGGER IF NOT EXISTS anonymous_events_increment_count
AFTER INSERT ON anonymous_events
BEGIN
  INSERT INTO anonymous_counts (event_type, period, release, total)
  VALUES (NEW.event_type, NEW.period, NEW.release, 1)
  ON CONFLICT (event_type, period, release)
  DO UPDATE SET total = total + 1;
END;

-- The status uses the HMAC digest of the stable anonymous install identifier.
-- It therefore updates the same opaque installation identity that produced an
-- install event, without retaining any raw identifier or request metadata. It
-- is durable server-side opt-out state and is deliberately not retention-pruned.
CREATE TABLE IF NOT EXISTS anonymous_install_status (
  token_digest TEXT PRIMARY KEY CHECK (
    length(token_digest) = 64
    AND token_digest NOT GLOB '*[^0-9a-f]*'
  ),
  status TEXT NOT NULL CHECK (status IN ('enabled', 'disabled')),
  preference_generation INTEGER NOT NULL CHECK (
    preference_generation BETWEEN 0 AND 9007199254740991
  ),
  release TEXT NOT NULL CHECK (length(release) BETWEEN 1 AND 64),
  updated_at TEXT NOT NULL
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS anonymous_install_status_updated_at
  ON anonymous_install_status (updated_at);
