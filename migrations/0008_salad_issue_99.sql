-- The first salad, from issue #99 (sent through the form before POST /salad existed). Pending and tied to the
-- issue, so the Worker's cron approves it once the pull request that closes #99 is merged, like any other salad.
INSERT OR IGNORE INTO salads (name, ingredients, price, issue) VALUES (
  'Tonfiskdrömmen',
  '["lite grönsallad i botten","pasta med tomatsmak","rödlök","1 ägg","kryddig tonfiskröra","soltorkad tomat","American dream-dressing","toppa med lite goudaost"]',
  '65–70 kr',
  99
);
