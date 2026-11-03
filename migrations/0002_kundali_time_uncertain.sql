-- A kundali generated without a known birth time is cast for 12:00 noon.
-- The request payload can't tell that apart from a real noon birth, so record it.
ALTER TABLE kundalis ADD COLUMN time_uncertain INTEGER NOT NULL DEFAULT 0;
