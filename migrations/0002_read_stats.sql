-- Daily read counts copied each night from Analytics Engine, which keeps raw events for 3 months only.
-- No IP, cookie or full User-Agent is stored: a read is a path, a client class, a named agent and a country.
CREATE TABLE read_daily (
  day           TEXT NOT NULL CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  path          TEXT NOT NULL CHECK (path LIKE '/%'),
  client_class  TEXT NOT NULL CHECK (client_class IN ('human', 'ai', 'search', 'bot')),
  agent         TEXT NOT NULL,
  country       TEXT NOT NULL,
  reads         INTEGER NOT NULL CHECK (reads >= 0),
  PRIMARY KEY (day, path, client_class, agent, country)
) WITHOUT ROWID;

CREATE INDEX read_daily_by_path ON read_daily (path, day);
