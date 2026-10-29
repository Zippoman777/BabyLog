CREATE TABLE IF NOT EXISTS babies (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL,
  sex       TEXT NOT NULL,          -- 'girl' | 'boy'
  birth_iso TEXT NOT NULL,
  created   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id           TEXT PRIMARY KEY,
  baby_id      TEXT NOT NULL,
  type         TEXT NOT NULL,       -- breast|bottle|sleep|pee|poo|temp|weight|note
  at_iso       TEXT NOT NULL,
  end_iso      TEXT,
  duration_sec INTEGER,
  side         TEXT,                -- L|R|both
  ml           REAL,
  celsius      REAL,
  grams        INTEGER,
  note         TEXT,
  FOREIGN KEY (baby_id) REFERENCES babies(id) ON DELETE CASCADE
);

-- one running timer per (baby, kind)
CREATE TABLE IF NOT EXISTS timers (
  id        TEXT PRIMARY KEY,
  baby_id   TEXT NOT NULL,
  kind      TEXT NOT NULL,          -- breast-L | breast-R | sleep
  start_iso TEXT NOT NULL,
  UNIQUE (baby_id, kind),
  FOREIGN KEY (baby_id) REFERENCES babies(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_events_baby ON events(baby_id, at_iso);
