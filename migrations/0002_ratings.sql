-- 1–5 stars per dish per day. `voter` is a random id the browser makes up (localStorage), not tied to a person,
-- so a changed vote replaces the old one. No IPs or names are stored.
CREATE TABLE ratings (
  date TEXT NOT NULL,
  restaurant TEXT NOT NULL,
  dish TEXT NOT NULL,
  voter TEXT NOT NULL,
  stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (date, restaurant, dish, voter)
);
CREATE INDEX ratings_date ON ratings (date);
