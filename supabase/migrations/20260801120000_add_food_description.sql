-- A meal logged as one item needs somewhere to keep the model's description of
-- what was on the plate. Without it, collapsing an AI breakdown into a single
-- entry would throw the detail away entirely rather than folding it up.
--
-- Nullable and additive: every existing food row stays valid untouched.

ALTER TABLE foods ADD COLUMN IF NOT EXISTS description TEXT;
