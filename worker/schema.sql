CREATE TABLE IF NOT EXISTS rsvp_submissions (
  invite_id TEXT PRIMARY KEY,
  guest TEXT NOT NULL,
  suffix TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL CHECK (state IN ('pending', 'success')),
  created_at TEXT NOT NULL,
  completed_at TEXT
);

