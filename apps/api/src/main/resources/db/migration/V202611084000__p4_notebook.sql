-- Part 4: lab notebook (build plan 4.6). Entries are generated from each attempt's event log;
-- only the learner's own writing is stored.
CREATE TABLE notebook_entries (
    attempt_id  uuid        PRIMARY KEY REFERENCES experiment_attempts (id) ON DELETE CASCADE,
    user_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    notes       text        NOT NULL DEFAULT '',
    conclusion  text,
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Answers saved from the assistant outside any experiment.
CREATE TABLE notebook_clips (
    id          uuid        PRIMARY KEY,
    user_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    text        text        NOT NULL,
    source      text,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notebook_clips_user ON notebook_clips (user_id, created_at DESC);
