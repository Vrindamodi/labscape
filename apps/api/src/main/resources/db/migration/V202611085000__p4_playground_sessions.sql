-- Part 4: playground session history and the free plan's daily limit (build plan 4.9).
CREATE TABLE playground_sessions (
    id          uuid        PRIMARY KEY,
    user_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    mode        text        NOT NULL CHECK (mode IN ('chemistry', 'circuits', 'motion', 'graphing')),
    title       text,
    snapshot    jsonb,
    started_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX playground_sessions_user ON playground_sessions (user_id, started_at DESC);
