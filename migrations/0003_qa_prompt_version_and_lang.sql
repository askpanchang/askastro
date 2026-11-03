-- Prompt version used for each assistant answer (BUILD_PROMPT §9.3).
ALTER TABLE qa_messages ADD COLUMN prompt_version TEXT;
-- Answer language per session (en | hi | te).
ALTER TABLE qa_sessions ADD COLUMN lang TEXT NOT NULL DEFAULT 'en';
