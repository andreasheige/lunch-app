-- News posts, one per release (a PR, or a commit pushed without one), written once per language by Workers AI
-- (see worker.ts releasePosts). `text` is the ReleaseText JSON: title, summary, intro, changes.
-- The per-commit tables release_notes and release_notes_en are no longer read.
CREATE TABLE release_posts (
  key TEXT NOT NULL,
  lang TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (key, lang)
);
