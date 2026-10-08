-- English release-note texts for /nyheter in English, written once per feat/fix commit by Workers AI
-- (see worker.ts releaseNotes). Same shape as release_notes.
CREATE TABLE release_notes_en (
  sha TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
