-- The share card the panel rendered for a page, as an uploaded image key. NULL falls back to the site card.
ALTER TABLE posts ADD COLUMN og_key TEXT;
ALTER TABLE projects ADD COLUMN og_key TEXT;
