-- Profile sharing: the owner grants a family member (by Access email) view +
-- Q&A access to one profile. Q&A sessions belong to whoever created them.
CREATE TABLE profile_shares (
  profile_id  TEXT NOT NULL REFERENCES profiles(id),
  email       TEXT NOT NULL,   -- grantee, lower-cased
  created_by  TEXT NOT NULL,   -- the profile owner who shared it
  created_at  TEXT NOT NULL,
  PRIMARY KEY (profile_id, email)
);
CREATE INDEX idx_shares_email ON profile_shares(email);

-- Session owner (creator). Existing sessions belong to their profile's owner.
ALTER TABLE qa_sessions ADD COLUMN owner_id TEXT NOT NULL DEFAULT '';
UPDATE qa_sessions SET owner_id = (SELECT p.owner_id FROM profiles p WHERE p.id = qa_sessions.profile_id);
CREATE INDEX idx_sessions_owner ON qa_sessions(owner_id, profile_id, updated_at DESC);
