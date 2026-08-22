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
