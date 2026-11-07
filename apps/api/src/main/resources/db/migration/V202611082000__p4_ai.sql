-- Part 4: AI assistant conversations, logged for review (build plan 4.4).
CREATE TABLE ai_conversations (
    id          uuid        PRIMARY KEY,
    user_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    surface     text,
    experiment  text,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ai_messages (
    id               uuid        PRIMARY KEY,
    conversation_id  uuid        NOT NULL REFERENCES ai_conversations (id) ON DELETE CASCADE,
    user_id          uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role             text        NOT NULL CHECK (role IN ('user', 'assistant')),
    content          text        NOT NULL,
    model            text,
    flagged          boolean     NOT NULL DEFAULT false,
    category         text,
    context_injected boolean     NOT NULL DEFAULT false,
    grounding        jsonb,
    rating           smallint    CHECK (rating IN (-1, 1)),
    created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_messages_user_day ON ai_messages (user_id, created_at) WHERE role = 'user';
CREATE INDEX ai_messages_flagged ON ai_messages (created_at) WHERE flagged;
