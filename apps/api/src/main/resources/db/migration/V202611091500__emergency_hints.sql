-- Emergency simulator hints: the highest hint rung (1-3) taken in each scene of a run, keyed by scene id.
-- Each rung costs a few points at the end of the run, and the debrief shows where hints were used.
ALTER TABLE emergency_attempts ADD COLUMN hints jsonb NOT NULL DEFAULT '{}'::jsonb;
