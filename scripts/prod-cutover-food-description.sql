-- hyPer: production cutover for the combined-meal description column.
-- Re-runnable and additive. One transaction: if it fails, nothing is applied.
-- Paste into Supabase Dashboard -> SQL Editor -> Run (PRODUCTION nnwfaaxmyvqsdnfcdxom).

BEGIN;

-- ===== 20260801120000_add_food_description.sql =====
-- A meal logged as one item needs somewhere to keep the model's description of
-- what was on the plate. Nullable and additive: every existing food row stays
-- valid untouched, and nothing is rewritten.

ALTER TABLE foods ADD COLUMN IF NOT EXISTS description TEXT;

COMMIT;
