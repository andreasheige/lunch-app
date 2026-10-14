-- Each weekday's menus as the site showed them, saved by worker.ts when it builds the day's /lunch.json, so the
-- /stats page can show history (diet mix per day, dishes that come back). Menu text only, nothing about visitors.
CREATE TABLE menu_days (
  date TEXT NOT NULL,
  restaurant TEXT NOT NULL,
  dish TEXT NOT NULL,
  description TEXT,
  diet TEXT,
  mentions TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (date, restaurant, dish)
);
CREATE INDEX menu_days_date ON menu_days (date);
