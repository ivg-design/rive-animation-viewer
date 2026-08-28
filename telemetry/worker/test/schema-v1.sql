CREATE TABLE anonymous_events (
  event_type TEXT NOT NULL CHECK (event_type IN ('install', 'monthly_active')),
  period TEXT NOT NULL,
  token_digest TEXT NOT NULL,
  release TEXT NOT NULL,
  received_at TEXT NOT NULL,
  PRIMARY KEY (event_type, period, token_digest)
) WITHOUT ROWID;

CREATE TABLE anonymous_counts (
  event_type TEXT NOT NULL,
  period TEXT NOT NULL,
  release TEXT NOT NULL,
  total INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (event_type, period, release)
) WITHOUT ROWID;

CREATE TRIGGER anonymous_events_increment_count
AFTER INSERT ON anonymous_events
BEGIN
  INSERT INTO anonymous_counts (event_type, period, release, total)
  VALUES (NEW.event_type, NEW.period, NEW.release, 1)
  ON CONFLICT (event_type, period, release)
  DO UPDATE SET total = total + 1;
END;
