-- Awards and open-source contributions for the public /awards page, edited from the panel. No revisions.
-- updated_at is the panel's optimistic lock (milliseconds, so two saves inside one second differ).
CREATE TABLE achievements (
  id          INTEGER PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('award', 'contribution')),
  title       TEXT NOT NULL,
  context     TEXT NOT NULL DEFAULT '',   -- event or project name
  outcome     TEXT NOT NULL DEFAULT '',   -- e.g. "2nd in Turkey", "merged in Linux 7.3"
  summary     TEXT NOT NULL DEFAULT '',
  year        INTEGER NOT NULL,
  links       TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(links)),   -- [{"label":"Result","url":"https://..."}]
  sort_order  INTEGER NOT NULL DEFAULT 0,
  visible     INTEGER NOT NULL DEFAULT 0 CHECK (visible IN (0, 1)),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
