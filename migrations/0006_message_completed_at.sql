-- When each answer finished, so the chat can show how long it took.
ALTER TABLE qa_messages ADD COLUMN completed_at TEXT;
