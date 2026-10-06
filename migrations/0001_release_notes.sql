-- Swedish release-note texts, written once per feat/fix commit by Workers AI (see worker.ts releaseNotes).
-- Edit one by hand: wrangler d1 execute lunch-app --remote --command "UPDATE release_notes SET title = '…' WHERE sha = '…'"
CREATE TABLE release_notes (
  sha TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
