-- The gallery's tables.
--
--   npx wrangler d1 execute castillon-gallery --remote --file=src/share/schema.sql
--
-- Written to be safe to run twice, so applying it again after a change is not a decision.

-- An entry is a *publication*, not a patch (PLAN §12.1): several entries may carry the same code,
-- because two people can publish the same patch under their own names. `code` is the long patch
-- code, so a card can draw the cascade and load it without redeeming a pointer first.
--
-- `publisher` is a hash of a secret the browser keeps, never an address. It is what puts a trash
-- icon on your own entry for a day (PLAN §12.6); hashed so that reading the table does not hand
-- anyone the means to delete other people's work.
CREATE TABLE IF NOT EXISTS entries (
  id         TEXT PRIMARY KEY,
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  author     TEXT NOT NULL,
  country    TEXT,
  created_at INTEGER NOT NULL,
  publisher  TEXT NOT NULL
);

-- The default ordering, and the reason the window opens on it (PLAN §12.7).
CREATE INDEX IF NOT EXISTS entries_recent ON entries (created_at DESC);

-- One row per browser per entry rather than a counter, so a single person cannot run a count up by
-- clicking. Hashed for the same reason as `publisher`.
CREATE TABLE IF NOT EXISTS stars (
  entry_id TEXT NOT NULL,
  voter    TEXT NOT NULL,
  PRIMARY KEY (entry_id, voter)
);

CREATE INDEX IF NOT EXISTS stars_entry ON stars (entry_id);

-- The publish rate limit asks "how many has this publisher added since a moment", which without this
-- reads every row in the table. Both columns, in that order, so the count is answered from the index
-- alone rather than by visiting the rows it points at.
CREATE INDEX IF NOT EXISTS entries_publisher ON entries (publisher, created_at);
