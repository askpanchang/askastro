-- Suggested follow-up questions for an answer (JSON array of strings), shown
-- as buttons under the latest answer.
ALTER TABLE qa_messages ADD COLUMN followups TEXT;
