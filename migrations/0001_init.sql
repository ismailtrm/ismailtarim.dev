-- All timestamps are ISO 8601 UTC text ('2026-10-30T13:00:00Z') so string order equals time order.
-- Writing and Notes share one table, split by kind (shared tags and revision history).
CREATE TABLE posts (
  id            INTEGER PRIMARY KEY,
  kind          TEXT NOT NULL CHECK (kind IN ('writing', 'note')),
  slug          TEXT NOT NULL CHECK (slug <> '' AND slug NOT GLOB '*[^a-z0-9-]*'),
  title         TEXT NOT NULL,
  summary       TEXT,
  lang          TEXT NOT NULL DEFAULT 'en' CHECK (lang IN ('en', 'tr')),
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  body_md       TEXT NOT NULL,
  body_html     TEXT NOT NULL,
  published_at  TEXT CHECK (published_at IS NULL OR strftime('%Y-%m-%dT%H:%M:%SZ', published_at) = published_at),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE (kind, slug),
  CHECK (status <> 'published' OR published_at IS NOT NULL)
);
CREATE INDEX posts_listing ON posts (kind, status, published_at DESC);
CREATE INDEX posts_by_status ON posts (status, published_at DESC);

CREATE TRIGGER posts_touch AFTER UPDATE ON posts FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE posts SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = NEW.id;
END;

-- Notes only: the Symptom / Fix box and the environment the note was verified on.
CREATE TABLE note_meta (
  post_id      INTEGER PRIMARY KEY REFERENCES posts (id) ON DELETE CASCADE,
  symptom      TEXT NOT NULL,
  fix          TEXT NOT NULL,
  environment  TEXT NOT NULL CHECK (json_valid(environment)),  -- e.g. {"kernel":"7.2.11","distro":"Arch"}
  verified_at  TEXT NOT NULL
);

-- One row per save: a full copy; diffs are computed in the panel.
CREATE TABLE revisions (
  id          INTEGER PRIMARY KEY,
  post_id     INTEGER NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  body_md     TEXT NOT NULL,
  meta_json   TEXT CHECK (meta_json IS NULL OR json_valid(meta_json)),
  reason      TEXT NOT NULL CHECK (reason IN ('save', 'publish', 'restore')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX revisions_by_post ON revisions (post_id, created_at DESC);

CREATE TABLE tags (
  id    INTEGER PRIMARY KEY,
  slug  TEXT NOT NULL UNIQUE CHECK (slug <> '' AND slug NOT GLOB '*[^a-z0-9-]*'),
  name  TEXT NOT NULL
);

CREATE TABLE post_tags (
  post_id  INTEGER NOT NULL REFERENCES posts (id) ON DELETE CASCADE,
  tag_id   INTEGER NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, tag_id)
);
CREATE INDEX post_tags_by_tag ON post_tags (tag_id);

-- Projects: one evidence-table row each, optional case study.
CREATE TABLE projects (
  id          INTEGER PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE CHECK (slug <> '' AND slug NOT GLOB '*[^a-z0-9-]*'),
  name        TEXT NOT NULL,
  summary     TEXT NOT NULL,
  year        INTEGER NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('merged', 'under_review', 'submitted', 'published', 'personal')),
  case_md     TEXT,
  case_html   TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  visible     INTEGER NOT NULL DEFAULT 0
);

-- Upstream badges and evidence links.
CREATE TABLE project_links (
  id          INTEGER PRIMARY KEY,
  project_id  INTEGER NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('commit', 'pr', 'patch', 'paper', 'repo', 'demo', 'talk')),
  label       TEXT NOT NULL,
  url         TEXT NOT NULL CHECK (url GLOB 'https://*' OR url GLOB 'http://*'),
  sort_order  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX project_links_by_project ON project_links (project_id, sort_order);

-- Images stored in R2.
CREATE TABLE assets (
  id            INTEGER PRIMARY KEY,
  r2_key        TEXT NOT NULL UNIQUE,
  alt           TEXT NOT NULL,
  width         INTEGER,
  height        INTEGER,
  content_type  TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Old paths keep working after a slug change (301 to the new path).
CREATE TABLE redirects (
  from_path   TEXT PRIMARY KEY CHECK (from_path GLOB '/*'),
  -- Same-site paths only: blocks //host and /\host open redirects and self-loops.
  to_path     TEXT NOT NULL CHECK (to_path GLOB '/*' AND to_path NOT GLOB '//*' AND to_path NOT GLOB '/[\\]*' AND to_path <> from_path),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
