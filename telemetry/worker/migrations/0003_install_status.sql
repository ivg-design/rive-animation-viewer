-- Apply after the released schema-v1 anonymous counter and before 0004. This
-- CREATE-only migration is safe to rerun. The rows are durable server-side
-- opt-out state and are deliberately not retention-pruned.
CREATE TABLE IF NOT EXISTS anonymous_install_status (
  token_digest TEXT PRIMARY KEY CHECK (
    length(token_digest) = 64
    AND token_digest NOT GLOB '*[^0-9a-f]*'
  ),
  status TEXT NOT NULL CHECK (status IN ('enabled', 'disabled')),
  release TEXT NOT NULL CHECK (length(release) BETWEEN 1 AND 64),
  updated_at TEXT NOT NULL
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS anonymous_install_status_updated_at
  ON anonymous_install_status (updated_at);
