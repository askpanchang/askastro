-- Set by POST /api/sessions/:id/stop. Only an explicit Stop ends an answer early;
-- a dropped connection lets it finish and be saved.
ALTER TABLE qa_messages ADD COLUMN stop_requested INTEGER NOT NULL DEFAULT 0;
