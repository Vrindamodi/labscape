-- Shared-foundation baseline (owner: all four parts).
-- Naming convention: V<yyyyMMddHHmm>__p<part>_<description>.sql
--   e.g. V202611120930__p2_reaction_versions.sql
-- A part never alters another part's tables; it opens a PR to the owner.

-- pgvector: used by Part 4 for retrieval over reviewed content (available on Neon).
CREATE EXTENSION IF NOT EXISTS vector;
-- Case-insensitive text for emails/usernames (Part 1).
CREATE EXTENSION IF NOT EXISTS citext;
