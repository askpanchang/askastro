-- Kundali Studio initial schema (docs/BUILD_PROMPT.md §6).
-- IDs are text UUIDs; timestamps are ISO-8601 UTC strings.

CREATE TABLE profiles (
  id            TEXT PRIMARY KEY,
  owner_id      TEXT NOT NULL DEFAULT 'default',
  name          TEXT NOT NULL,
  gender        TEXT NOT NULL CHECK (gender IN ('m','f','o')),
  dob           TEXT NOT NULL,            -- YYYY-MM-DD
  tob           TEXT,                     -- HH:MM (24h), NULL if unknown
  tob_unknown   INTEGER NOT NULL DEFAULT 0,
  place         TEXT NOT NULL,            -- display string, e.g. "Hyderabad, Telangana, India"
  lat           REAL NOT NULL,
  lon           REAL NOT NULL,
  tz            TEXT NOT NULL,            -- IANA, e.g. Asia/Kolkata
  notes         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT
);
CREATE INDEX idx_profiles_owner_name ON profiles(owner_id, name);
CREATE INDEX idx_profiles_owner_created ON profiles(owner_id, created_at DESC, id DESC);

CREATE TABLE kundalis (
  id            TEXT PRIMARY KEY,
  profile_id    TEXT NOT NULL REFERENCES profiles(id),
  ayanamsa      TEXT NOT NULL,
  chart_style   TEXT NOT NULL,
  lang          TEXT NOT NULL,
  request_json  TEXT NOT NULL,            -- exact payload sent
  response_json TEXT NOT NULL,            -- full raw API response
  digest        TEXT NOT NULL,            -- compact text used as LLM context
  input_hash    TEXT NOT NULL,            -- hash of birth data + options, to detect stale charts
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_kundalis_profile ON kundalis(profile_id, created_at DESC);

CREATE TABLE qa_sessions (
  id            TEXT PRIMARY KEY,
  profile_id    TEXT NOT NULL REFERENCES profiles(id),
  kundali_id    TEXT NOT NULL REFERENCES kundalis(id),
  title         TEXT NOT NULL,
  model         TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT
);
CREATE INDEX idx_sessions_profile ON qa_sessions(profile_id, updated_at DESC);

CREATE TABLE qa_messages (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL REFERENCES qa_sessions(id),
  role          TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'complete' CHECK (status IN ('complete','streaming','error')),
  tokens_in     INTEGER,
  tokens_out    INTEGER,
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_messages_session ON qa_messages(session_id, created_at);
