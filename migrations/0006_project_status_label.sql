-- Free text shown instead of the fixed status label, e.g. "submitted to KubeCon EU 2027". NULL keeps the fixed label.
ALTER TABLE projects ADD COLUMN status_label TEXT;
