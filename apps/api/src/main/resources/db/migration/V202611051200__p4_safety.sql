-- Part 4: validation and safety engine (build plan 4.1).

-- Reviewed prohibited-pattern rules. v1 ships rules from classpath safety/rules.json; Part 1's safety
-- admin will edit them here (with seven-stage review) and the rule book will read from this table.
CREATE TABLE safety_rules (
    id           text PRIMARY KEY,
    version      integer     NOT NULL DEFAULT 1,
    all_of_tags  text[]      NOT NULL,
    description  text        NOT NULL,
    active       boolean     NOT NULL DEFAULT true,
    reviewed_by  text,
    reviewed_at  timestamptz,
    updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Every safety decision, append-only. Prohibited rows carry the matching rule id (server-side only).
CREATE TABLE safety_audit (
    id           bigserial   PRIMARY KEY,
    created_at   timestamptz NOT NULL DEFAULT now(),
    session_key  text        NOT NULL,
    attempt_id   text        NOT NULL,
    request_id   text        NOT NULL,
    outcome      text        NOT NULL,
    reason_code  text,
    rule_id      text,
    inputs       jsonb       NOT NULL,
    flagged      boolean     NOT NULL DEFAULT false
);

CREATE INDEX safety_audit_session_idx ON safety_audit (session_key, created_at DESC);
CREATE INDEX safety_audit_flagged_idx ON safety_audit (created_at DESC) WHERE flagged;
