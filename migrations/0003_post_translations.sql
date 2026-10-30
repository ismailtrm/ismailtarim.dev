-- A post can now exist once per language under the same slug: UNIQUE (kind, slug) becomes UNIQUE (kind, lang, slug).
-- SQLite cannot alter a constraint, so the table is rebuilt. Ids are kept, so note_meta, revisions and post_tags still match.
-- Deferring foreign keys only postpones violations; DROP TABLE still runs the ON DELETE CASCADE of the child tables
-- (measured: it emptied them). So the children are parked in copies first and put back after the rename.
PRAGMA defer_foreign_keys = true;

CREATE TABLE note_meta_keep AS SELECT * FROM note_meta;
CREATE TABLE revisions_keep AS SELECT * FROM revisions;
CREATE TABLE post_tags_keep AS SELECT * FROM post_tags;

CREATE TABLE posts_new (
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
  UNIQUE (kind, lang, slug),
  CHECK (status <> 'published' OR published_at IS NOT NULL)
);

INSERT INTO posts_new (id, kind, slug, title, summary, lang, status, body_md, body_html, published_at, created_at, updated_at)
SELECT id, kind, slug, title, summary, lang, status, body_md, body_html, published_at, created_at, updated_at FROM posts;

DROP TABLE posts;
ALTER TABLE posts_new RENAME TO posts;

INSERT INTO note_meta SELECT * FROM note_meta_keep;
INSERT INTO revisions SELECT * FROM revisions_keep;
INSERT INTO post_tags SELECT * FROM post_tags_keep;
DROP TABLE note_meta_keep;
DROP TABLE revisions_keep;
DROP TABLE post_tags_keep;

CREATE INDEX posts_listing ON posts (kind, status, published_at DESC);
CREATE INDEX posts_by_status ON posts (status, published_at DESC);
-- Finds the other languages of one post (hreflang, language switch); the unique index leads with lang.
CREATE INDEX posts_by_slug ON posts (kind, slug);

CREATE TRIGGER posts_touch AFTER UPDATE ON posts FOR EACH ROW WHEN NEW.updated_at = OLD.updated_at
BEGIN
  UPDATE posts SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = NEW.id;
END;
