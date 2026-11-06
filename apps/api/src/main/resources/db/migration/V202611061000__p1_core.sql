-- Part 1: Platform Core and Game Layer (build plan 1.1 - 1.12).
-- Tables owned by Part 1 only. Other parts read through views Part 1 publishes.

-- ---------------------------------------------------------------- accounts
CREATE TABLE users (
    id              uuid        PRIMARY KEY,
    email           citext      UNIQUE,
    password_hash   text,
    google_sub      text        UNIQUE,
    username        citext      NOT NULL UNIQUE,
    display_name    text        NOT NULL,
    is_guest        boolean     NOT NULL DEFAULT false,
    role            text        NOT NULL DEFAULT 'student'
                                CHECK (role IN ('student', 'teacher', 'reviewer', 'admin', 'super_admin')),
    age_band        text        CHECK (age_band IN ('under_13', '13_17', '18_plus')),
    parental_consent_at timestamptz,
    timezone        text        NOT NULL DEFAULT 'Asia/Kolkata',
    total_xp        bigint      NOT NULL DEFAULT 0,
    created_at      timestamptz NOT NULL DEFAULT now(),
    last_seen_at    timestamptz NOT NULL DEFAULT now(),
    disabled        boolean     NOT NULL DEFAULT false
);

CREATE TABLE user_profiles (
    user_id         uuid        PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    learning_level  text        CHECK (learning_level IN ('beginner', 'school', 'high_school', 'undergraduate', 'advanced', 'exploring')),
    interests       text[]      NOT NULL DEFAULT '{}',
    preference      text        CHECK (preference IN ('experiments', 'challenges', 'explanations', 'exploration')),
    avatar          jsonb       NOT NULL DEFAULT '{}'::jsonb,
    settings        jsonb       NOT NULL DEFAULT '{}'::jsonb,
    leaderboard_opt_out boolean NOT NULL DEFAULT false,
    onboarded_at    timestamptz,
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE password_resets (
    token_hash      text        PRIMARY KEY,
    user_id         uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    expires_at      timestamptz NOT NULL,
    used_at         timestamptz
);

-- ---------------------------------------------------------------- rewards
-- Every award, append-only. (user_id, idempotency_key) makes replays harmless.
CREATE TABLE xp_transactions (
    id              bigserial   PRIMARY KEY,
    user_id         uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    idempotency_key text        NOT NULL,
    kind            text        NOT NULL,
    ref_id          text        NOT NULL,
    subject         text,
    score           integer,
    base_xp         integer     NOT NULL,
    xp              integer     NOT NULL,
    adjustments     jsonb       NOT NULL DEFAULT '[]'::jsonb,
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, idempotency_key)
);
CREATE INDEX xp_tx_user_kind_ref_idx ON xp_transactions (user_id, kind, ref_id, created_at DESC);
CREATE INDEX xp_tx_created_idx ON xp_transactions (created_at);

CREATE TABLE achievements (
    id              text        PRIMARY KEY,
    name            text        NOT NULL,
    description     text        NOT NULL,
    icon            text        NOT NULL,
    tier            text        NOT NULL DEFAULT 'bronze' CHECK (tier IN ('bronze', 'silver', 'gold', 'platinum')),
    sort_order      integer     NOT NULL DEFAULT 0,
    target          integer     NOT NULL DEFAULT 1
);

CREATE TABLE user_achievements (
    user_id         uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    achievement_id  text        NOT NULL REFERENCES achievements (id),
    unlocked_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, achievement_id)
);

CREATE TABLE streaks (
    user_id         uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind            text        NOT NULL CHECK (kind IN ('login', 'experiment', 'quiz', 'weekly_challenge')),
    current_days    integer     NOT NULL DEFAULT 0,
    best_days       integer     NOT NULL DEFAULT 0,
    last_day        date,
    freeze_week     text,       -- ISO week ("2026-W45") in which the free freeze was used
    freeze_used_on  date,
    PRIMARY KEY (user_id, kind)
);

-- Daily challenges: three per user per day, seeded from the user id and the local date.
CREATE TABLE daily_challenge_progress (
    user_id         uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    day             date        NOT NULL,
    challenge_id    text        NOT NULL,
    progress        integer     NOT NULL DEFAULT 0,
    completed_at    timestamptz,
    PRIMARY KEY (user_id, day, challenge_id)
);

CREATE TABLE leaderboard_snapshots (
    id              bigserial   PRIMARY KEY,
    scope           text        NOT NULL,
    period_start    date        NOT NULL,
    ranking         jsonb       NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (scope, period_start)
);

-- ---------------------------------------------------------------- notifications
CREATE TABLE notifications (
    id              bigserial   PRIMARY KEY,
    user_id         uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind            text        NOT NULL,
    title           text        NOT NULL,
    body            text,
    link            text,
    dedupe_key      text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    read_at         timestamptz,
    UNIQUE (user_id, dedupe_key)
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);

-- ---------------------------------------------------------------- billing
CREATE TABLE subscriptions (
    id              uuid        PRIMARY KEY,
    user_id         uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    plan            text        NOT NULL CHECK (plan IN ('premium_monthly', 'premium_annual')),
    status          text        NOT NULL CHECK (status IN ('pending', 'active', 'grace', 'cancelled', 'expired')),
    provider        text        NOT NULL,
    provider_ref    text        UNIQUE,
    current_period_end timestamptz,
    cancel_at_period_end boolean NOT NULL DEFAULT false,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX subscriptions_user_idx ON subscriptions (user_id, created_at DESC);

CREATE TABLE payments (
    id              uuid        PRIMARY KEY,
    user_id         uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    subscription_id uuid        REFERENCES subscriptions (id),
    amount_paise    integer     NOT NULL,
    gst_paise       integer     NOT NULL,
    currency        text        NOT NULL DEFAULT 'INR',
    status          text        NOT NULL CHECK (status IN ('captured', 'failed', 'refunded')),
    provider_ref    text        UNIQUE,
    invoice_number  text        UNIQUE,
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- Replayed webhooks change nothing: each provider event id is processed once.
CREATE TABLE webhook_events (
    id              text        PRIMARY KEY,
    provider        text        NOT NULL,
    event_type      text        NOT NULL,
    received_at     timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- admin
CREATE TABLE admin_audit (
    id              bigserial   PRIMARY KEY,
    actor_id        uuid        NOT NULL REFERENCES users (id),
    action          text        NOT NULL,
    target          text,
    detail          jsonb       NOT NULL DEFAULT '{}'::jsonb,
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- seed: badges (build plan 1.5)
INSERT INTO achievements (id, name, description, icon, tier, sort_order, target) VALUES
  ('welcome',            'Welcome to LABscape!', 'Finish onboarding and your first lab introduction.', 'sparkles',      'bronze',   0, 1),
  ('first_experiment',   'First Experiment',     'Complete any experiment.',                          'flask-conical', 'bronze',  10, 1),
  ('chemistry_explorer', 'Chemistry Explorer',   'Complete 10 chemistry experiments.',                'atom',          'silver',  20, 10),
  ('physics_master',     'Physics Master',       'Complete 10 physics experiments.',                  'orbit',         'silver',  30, 10),
  ('maths_wizard',       'Mathematics Wizard',   'Complete 10 maths experiments.',                    'sigma',         'silver',  40, 10),
  ('perfect_score',      'Perfect Score',        'Score 100% on any quiz.',                           'target',        'gold',    50, 1),
  ('seven_day_streak',   'Seven-Day Streak',     'Keep a 7-day login streak.',                        'flame',         'gold',    60, 7),
  ('safety_champion',    'Safety Champion',      'Score 80+ on every emergency scenario.',            'shield-check',  'platinum',70, 5),
  ('playground_explorer','Playground Explorer',  'Make 10 discoveries in the Playground.',            'telescope',     'silver',  80, 10),
  ('molecular_detective','Molecular Detective',  'Open the molecular view on 10 different reactions.','microscope',    'gold',    90, 10),
  ('circuit_builder',    'Circuit Builder',      'Complete 5 circuit experiments.',                   'cpu',           'silver', 100, 5);
