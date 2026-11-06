-- Optional second person in a Q&A session (e.g. a spouse), pinned to that
-- profile's kundali at the time it was added. `relation` is Person 2's
-- relationship to Person 1 (the session's profile).
ALTER TABLE qa_sessions ADD COLUMN partner_profile_id TEXT REFERENCES profiles(id);
ALTER TABLE qa_sessions ADD COLUMN partner_kundali_id TEXT REFERENCES kundalis(id);
ALTER TABLE qa_sessions ADD COLUMN relation TEXT;
