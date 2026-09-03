-- Ridea Starter - zakladna schema.
-- Pravidlo: existujucu migraciu uz nikdy nemen, vzdy pridaj novu (0002_..., 0003_...).

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'submitter',  -- submitter | reviewer | admin
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ideas (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL REFERENCES users(id),
  title          TEXT,
  audio_key      TEXT,            -- kluc objektu v R2
  transcript     TEXT,
  status         TEXT NOT NULL DEFAULT 'processing', -- processing | done | error
  error_message  TEXT,
  ai_score       INTEGER,
  ai_summary     TEXT,
  ai_analysis    TEXT,            -- cely JSON z Claude
  duration_sec   REAL,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ideas_user    ON ideas(user_id);
CREATE INDEX IF NOT EXISTS idx_ideas_created ON ideas(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ideas_status  ON ideas(status);

-- Sliding-window rate limit pre login (viz src/routes/auth.ts).
CREATE TABLE IF NOT EXISTS login_attempts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ip_hash    TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_login_attempts ON login_attempts(ip_hash, created_at);

-- Volitelny kontext firmy, ktory sa vklada do promptu pre AI analyzu.
CREATE TABLE IF NOT EXISTS company_context (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
