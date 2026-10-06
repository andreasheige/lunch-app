-- Who asked to hear back when their report is done. Never sent to GitHub; a row is deleted as soon as its
-- email has gone out (worker.ts notifyReporters), or after 180 days if the issue is never closed.
CREATE TABLE report_contacts (
  issue INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
