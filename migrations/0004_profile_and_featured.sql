-- Home page profile, one row per language, edited from the panel (like posts, HTML is rendered in the browser and only stored here).
CREATE TABLE profile (
  lang        TEXT PRIMARY KEY CHECK (lang IN ('en', 'tr')),
  name        TEXT NOT NULL,
  headline    TEXT NOT NULL DEFAULT '',
  location    TEXT NOT NULL DEFAULT '',
  links       TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(links)),   -- [{"label":"GitHub","url":"https://..."}]
  badges      TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(badges)),  -- same shape
  avatar_key  TEXT,                                                   -- R2 key under img/, served by /media/
  body_md     TEXT NOT NULL DEFAULT '',
  body_html   TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- One row per save, same idea as revisions for posts: name and body_md as columns, the rest in meta_json.
CREATE TABLE profile_revisions (
  id          INTEGER PRIMARY KEY,
  lang        TEXT NOT NULL REFERENCES profile (lang) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  body_md     TEXT NOT NULL,
  meta_json   TEXT CHECK (meta_json IS NULL OR json_valid(meta_json)),
  reason      TEXT NOT NULL CHECK (reason IN ('save', 'publish', 'restore')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX profile_revisions_by_lang ON profile_revisions (lang, id DESC);

-- ADD COLUMN accepts REFERENCES only with a NULL default (SQLite): post_id stays NULL when the post goes away.
ALTER TABLE projects ADD COLUMN featured INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0, 1));
ALTER TABLE projects ADD COLUMN post_id INTEGER REFERENCES posts (id) ON DELETE SET NULL;
-- ON DELETE SET NULL looks the children up by post_id; without this a post delete scans projects.
CREATE INDEX projects_by_post ON projects (post_id) WHERE post_id IS NOT NULL;

-- Optimistic lock for the panel. ADD COLUMN cannot take a non-constant default, so the column is nullable
-- and existing rows are stamped here; the panel writes it on every save. Milliseconds, because two saves
-- inside one second must not look identical.
ALTER TABLE projects ADD COLUMN updated_at TEXT;
UPDATE projects SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
