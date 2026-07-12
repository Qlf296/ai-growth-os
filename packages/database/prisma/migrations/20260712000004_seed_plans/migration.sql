-- Phase 1.1 — plan rows (S3 §2: plan limits are DATA; S20: Free + Growth validate the gradient).
INSERT INTO plans (id, limits) VALUES
  ('free',   '{"daily_actions": 5, "connections": 1, "tier4_calls_month": 0, "poll_freq": "daily"}'),
  ('growth', '{}')  -- limits to be founder-ratified before launch (no invented decisional values)
ON CONFLICT (id) DO NOTHING;
