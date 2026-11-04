-- App-wide settings chosen by an admin in the app (e.g. the AI model).
CREATE TABLE app_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_by  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

-- The model that wrote each answer, so usage estimates stay right when the
-- model changes mid-session. Existing answers take their session's model.
ALTER TABLE qa_messages ADD COLUMN model TEXT;
UPDATE qa_messages SET model = (SELECT s.model FROM qa_sessions s WHERE s.id = qa_messages.session_id)
  WHERE role = 'assistant';
