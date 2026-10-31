-- Daily visitors and traffic sources, people only. Visitors come from a hash that changes every day,
-- so neither table holds an IP or a cookie, and the same person on two days counts twice.
CREATE TABLE visitors_daily (
  day       TEXT PRIMARY KEY CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  visitors  INTEGER NOT NULL CHECK (visitors >= 0),
  reads     INTEGER NOT NULL CHECK (reads >= 0)
) WITHOUT ROWID;

CREATE TABLE source_daily (
  day       TEXT NOT NULL CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  source    TEXT NOT NULL,
  campaign  TEXT NOT NULL,
  visitors  INTEGER NOT NULL CHECK (visitors >= 0),
  reads     INTEGER NOT NULL CHECK (reads >= 0),
  PRIMARY KEY (day, source, campaign)
) WITHOUT ROWID;
