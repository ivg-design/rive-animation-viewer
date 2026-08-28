-- Apply once after 0003_install_status.sql and before deploying a schema-v2
-- Worker. Existing schema-v1 status rows are generation zero, so later v2
-- preference changes supersede them monotonically.
ALTER TABLE anonymous_install_status
ADD COLUMN preference_generation INTEGER NOT NULL DEFAULT 0 CHECK (
  preference_generation BETWEEN 0 AND 9007199254740991
);
