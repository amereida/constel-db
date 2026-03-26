-- con§tel-db schema
-- Postgres (Netlify DB / Neon)

-- ─── Users ───────────────────────────────────────────────────────────
CREATE TABLE users (
  id            TEXT PRIMARY KEY,          -- from Netlify Identity sub
  email         TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL DEFAULT '',
  avatar_url    TEXT,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  profile_url   TEXT,                         -- e.g. Casiopea wiki page URL
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

-- ─── Sources (corpus texts) ─────────────────────────────────────────
CREATE TABLE sources (
  id          TEXT PRIMARY KEY DEFAULT 'src_' || substr(md5(random()::text), 1, 12),
  filename    TEXT NOT NULL,
  title       TEXT NOT NULL DEFAULT '',
  author      TEXT NOT NULL DEFAULT '',
  date        TEXT NOT NULL DEFAULT '',
  content     TEXT NOT NULL DEFAULT '',
  word_count  INTEGER NOT NULL DEFAULT 0,
  uploaded_by TEXT NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Concepts ────────────────────────────────────────────────────────
CREATE TABLE concepts (
  id          TEXT PRIMARY KEY DEFAULT 'con_' || substr(md5(random()::text), 1, 12),
  label       TEXT NOT NULL,
  created_by  TEXT NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(label)
);

-- ─── Themes ──────────────────────────────────────────────────────────
CREATE TABLE themes (
  id          TEXT PRIMARY KEY DEFAULT 'thm_' || substr(md5(random()::text), 1, 12),
  label       TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT '#888',
  created_by  TEXT NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(label)
);

-- ─── Theme ↔ Concept (many-to-many) ─────────────────────────────────
CREATE TABLE theme_concepts (
  theme_id    TEXT NOT NULL REFERENCES themes(id) ON DELETE CASCADE,
  concept_id  TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  added_by    TEXT NOT NULL REFERENCES users(id),
  added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (theme_id, concept_id)
);

-- ─── Excerpts (text selections) ─────────────────────────────────────
CREATE TABLE excerpts (
  id          TEXT PRIMARY KEY DEFAULT 'exc_' || substr(md5(random()::text), 1, 12),
  source_id   TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  text        TEXT NOT NULL DEFAULT '',
  start_pos   INTEGER NOT NULL,
  end_pos     INTEGER NOT NULL,
  created_by  TEXT NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Excerpt ↔ Concept (many-to-many) ───────────────────────────────
CREATE TABLE concept_excerpts (
  concept_id  TEXT NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  excerpt_id  TEXT NOT NULL REFERENCES excerpts(id) ON DELETE CASCADE,
  linked_by   TEXT NOT NULL REFERENCES users(id),
  linked_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (concept_id, excerpt_id)
);

-- ─── Notes (theme annotations) ──────────────────────────────────────
CREATE TABLE notes (
  id          TEXT PRIMARY KEY DEFAULT 'note_' || substr(md5(random()::text), 1, 12),
  theme_id    TEXT REFERENCES themes(id) ON DELETE CASCADE,
  concept_id  TEXT REFERENCES concepts(id) ON DELETE CASCADE,
  text        TEXT NOT NULL DEFAULT '',
  created_by  TEXT NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (theme_id IS NOT NULL OR concept_id IS NOT NULL)
);

-- ─── Activity log (audit trail) ─────────────────────────────────────
CREATE TABLE activity_log (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  action      TEXT NOT NULL,            -- 'create_excerpt', 'add_concept_to_theme', 'delete_concept', etc.
  entity_type TEXT NOT NULL,            -- 'excerpt', 'concept', 'theme', 'note', 'source'
  entity_id   TEXT NOT NULL,
  detail      JSONB,                    -- optional extra data
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─── Indexes ─────────────────────────────────────────────────────────
CREATE INDEX idx_excerpts_source ON excerpts(source_id);
CREATE INDEX idx_excerpts_user ON excerpts(created_by);
CREATE INDEX idx_concept_excerpts_concept ON concept_excerpts(concept_id);
CREATE INDEX idx_concept_excerpts_excerpt ON concept_excerpts(excerpt_id);
CREATE INDEX idx_theme_concepts_theme ON theme_concepts(theme_id);
CREATE INDEX idx_theme_concepts_concept ON theme_concepts(concept_id);
CREATE INDEX idx_notes_theme ON notes(theme_id);
CREATE INDEX idx_activity_user ON activity_log(user_id);
CREATE INDEX idx_activity_entity ON activity_log(entity_type, entity_id);
