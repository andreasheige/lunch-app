-- Picadeli salads visitors suggest (POST /salad). Each opens a GitHub issue; the Worker's cron marks it approved
-- once the issue is closed as completed and deletes it when closed as not planned. Only approved salads are shown.
-- Salad text only: no name, email or IP of the person who sent it.
CREATE TABLE salads (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  ingredients TEXT NOT NULL,
  price TEXT,
  issue INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
