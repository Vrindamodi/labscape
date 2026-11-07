-- Part 4: quizzes (build plan 4.5).

-- One row per quiz sitting. The drawn questions are stored so grading uses exactly what was served.
CREATE TABLE quiz_attempts (
    id                  uuid        PRIMARY KEY,
    user_id             uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    quiz_id             text        NOT NULL,
    experiment_attempt  uuid,
    question_ids        jsonb       NOT NULL,
    status              text        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'submitted')),
    idempotency_key     text,
    answers             jsonb,
    score_pct           int,
    passed              boolean,
    result              jsonb,
    created_at          timestamptz NOT NULL DEFAULT now(),
    submitted_at        timestamptz,
    UNIQUE (user_id, idempotency_key)
);
CREATE INDEX quiz_attempts_user_quiz ON quiz_attempts (user_id, quiz_id, submitted_at DESC);

-- Bayesian knowledge tracing: probability the learner knows each concept.
CREATE TABLE concept_mastery (
    user_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    concept_id  text        NOT NULL,
    p_known     double precision NOT NULL,
    attempts    int         NOT NULL DEFAULT 0,
    correct     int         NOT NULL DEFAULT 0,
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, concept_id)
);

-- Drafted questions (by authors or the AI) wait here; only approved ones join the live pool.
CREATE TABLE quiz_question_drafts (
    id           uuid        PRIMARY KEY,
    quiz_id      text        NOT NULL,
    question     jsonb       NOT NULL,
    source       text        NOT NULL CHECK (source IN ('ai', 'author')),
    status       text        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'rejected')),
    checks       jsonb       NOT NULL DEFAULT '[]'::jsonb,
    created_by   uuid        REFERENCES users (id) ON DELETE SET NULL,
    reviewed_by  uuid        REFERENCES users (id) ON DELETE SET NULL,
    reviewed_at  timestamptz,
    notes        text,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX quiz_question_drafts_status ON quiz_question_drafts (status, created_at);
