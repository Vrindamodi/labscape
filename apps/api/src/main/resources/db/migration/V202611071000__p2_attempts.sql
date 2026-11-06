-- Part 2: experiment attempts and the append-only LabEvent log (contract 2).
-- Experiment definitions are reviewed content files (content/experiments) shipped with the
-- engine bundle; the CMS tables arrive with the admin content editor.

CREATE TABLE experiment_attempts (
    id              uuid        PRIMARY KEY,
    user_id         uuid        NOT NULL,
    experiment_slug text        NOT NULL,
    experiment_version integer  NOT NULL,
    engine_version  text        NOT NULL,
    status          text        NOT NULL DEFAULT 'in_progress'
                                CHECK (status IN ('in_progress', 'completed', 'safety_stopped', 'abandoned')),
    stage           text        NOT NULL DEFAULT 'intro',
    started_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    completed_at    timestamptz,
    score           integer,
    stars           integer,
    report          jsonb,
    server_hash     text,
    client_hash     text
);
CREATE INDEX experiment_attempts_user_idx ON experiment_attempts (user_id, experiment_slug, updated_at DESC);

CREATE TABLE lab_events (
    attempt_id      uuid        NOT NULL REFERENCES experiment_attempts (id) ON DELETE CASCADE,
    seq             integer     NOT NULL,
    id              text        NOT NULL,
    t               bigint      NOT NULL,
    actor           text        NOT NULL CHECK (actor IN ('user', 'demo', 'system')),
    type            text        NOT NULL,
    payload         jsonb       NOT NULL,
    state_hash      text,
    received_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (attempt_id, seq)
);

-- Read-only view Part 1 uses for "Continue learning" and analytics.
CREATE VIEW v_attempt_progress AS
SELECT a.id, a.user_id, a.experiment_slug, a.status, a.stage, a.score, a.stars, a.started_at, a.updated_at,
       (SELECT count(*) FROM lab_events e WHERE e.attempt_id = a.id) AS event_count
  FROM experiment_attempts a;
