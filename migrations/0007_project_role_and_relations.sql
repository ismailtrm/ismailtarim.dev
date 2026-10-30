-- Facts shown beside a case study, and which project an award or contribution belongs to.
ALTER TABLE projects ADD COLUMN role TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN team TEXT NOT NULL DEFAULT '';
ALTER TABLE achievements ADD COLUMN project_id INTEGER REFERENCES projects (id) ON DELETE SET NULL;
