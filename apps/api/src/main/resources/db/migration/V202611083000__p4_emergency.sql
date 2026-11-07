-- Part 4: emergency simulator attempts (build plan 4.3). Choices are resolved and scored here,
-- so the client never holds the answers.
CREATE TABLE emergency_attempts (
    id           uuid        PRIMARY KEY,
    user_id      uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    scenario     text        NOT NULL,
    scene        text,
    hazard       double precision NOT NULL DEFAULT 0,
    choices      jsonb       NOT NULL DEFAULT '[]'::jsonb,
    ending       text,
    status       text        NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed')),
    score        int,
    result       jsonb,
    started_at   timestamptz NOT NULL DEFAULT now(),
    finished_at  timestamptz
);
CREATE INDEX emergency_attempts_user ON emergency_attempts (user_id, scenario, finished_at DESC);

-- "Score 80+ on every emergency scenario": four scenarios ship in the first release.
UPDATE achievements SET target = 4 WHERE id = 'safety_champion';
