-- Mi@Social_ia — esquema inicial. Todas las fechas en UTC, formato ISO 8601 ('2026-10-09T16:00:00.000Z').

-- Cuenta conectada de Meta: página de Facebook + Instagram profesional vinculado.
CREATE TABLE meta_accounts (
  id               INTEGER PRIMARY KEY,
  page_id          TEXT NOT NULL UNIQUE,
  page_name        TEXT,
  ig_user_id       TEXT,
  ig_username      TEXT,
  page_token_enc   TEXT NOT NULL,           -- token de página cifrado (AES-GCM, base64 iv:ciphertext)
  granted_scopes   TEXT,                    -- JSON array
  missing_scopes   TEXT,                    -- JSON array
  status           TEXT NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'reconnect_required')),
  status_detail    TEXT,
  token_checked_at TEXT,
  connected_by     TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

-- Estado anti-CSRF del diálogo OAuth.
CREATE TABLE oauth_states (
  state      TEXT PRIMARY KEY,
  actor      TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Campañas (backlog ítem 12); se crea ya para no rehacer el modelo.
CREATE TABLE campaigns (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  starts_on  TEXT,
  ends_on    TEXT,
  created_at TEXT NOT NULL
);

-- Un borrador con dos versiones de texto (FB e IG).
CREATE TABLE posts (
  id               TEXT PRIMARY KEY,
  status           TEXT NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft', 'approved', 'scheduled', 'publishing', 'published', 'failed', 'rejected')),
  fb_text          TEXT NOT NULL DEFAULT '',
  ig_text          TEXT NOT NULL DEFAULT '',
  link_url         TEXT,                    -- enlace a choco.uy (con UTM en el backlog)
  image_key        TEXT,                    -- clave aleatoria en R2
  image_width      INTEGER,
  image_height     INTEGER,
  image_bytes      INTEGER,
  source_kind      TEXT,                    -- 'manual' | 'ai' | 'product' | 'calendar' ...
  source_ref       TEXT,                    -- URL/ID de la fuente en choco.uy
  campaign_id      TEXT REFERENCES campaigns(id),
  parent_post_id   TEXT REFERENCES posts(id), -- duplicados/reprogramados (backlog ítem 5)
  scheduled_at     TEXT,                    -- fecha de publicación pedida (UTC)
  approved_by      TEXT,                    -- email del JWT de Access
  approved_at      TEXT,
  rejected_by      TEXT,
  rejected_at      TEXT,
  rejection_reason TEXT,
  ai_model         TEXT,
  ai_prompt_version TEXT,
  ai_input_tokens  INTEGER,
  ai_output_tokens INTEGER,
  created_by       TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  -- Defensa en la base: un post fuera de draft/rejected siempre tiene aprobador y fecha.
  CHECK (status IN ('draft', 'rejected') OR (approved_by IS NOT NULL AND approved_by <> '' AND approved_at IS NOT NULL AND scheduled_at IS NOT NULL))
);
CREATE INDEX posts_status ON posts(status, scheduled_at);

-- Estado de publicación por red. Permite sumar redes (backlog ítem 19) sin tocar `posts`.
CREATE TABLE post_targets (
  id                 INTEGER PRIMARY KEY,
  post_id            TEXT NOT NULL REFERENCES posts(id),
  network            TEXT NOT NULL CHECK (network IN ('facebook', 'instagram')),
  status             TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'publishing', 'scheduled_native', 'ig_container_created', 'published', 'failed', 'cancelled')),
  attempts           INTEGER NOT NULL DEFAULT 0,
  next_attempt_at    TEXT NOT NULL,
  locked_at          TEXT,
  last_error         TEXT,
  container_id       TEXT,                  -- creation_id de Instagram
  container_created_at TEXT,
  status_checks      INTEGER NOT NULL DEFAULT 0,
  external_id        TEXT,                  -- ID devuelto por Meta
  published_at       TEXT,
  updated_at         TEXT NOT NULL,
  UNIQUE (post_id, network)
);
CREATE INDEX post_targets_due ON post_targets(status, next_attempt_at);

CREATE TABLE job_runs (
  id          INTEGER PRIMARY KEY,
  job         TEXT NOT NULL,
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  status      TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'ok', 'error')),
  summary     TEXT,
  error       TEXT
);
CREATE INDEX job_runs_job ON job_runs(job, started_at);

CREATE TABLE audit_log (
  id        INTEGER PRIMARY KEY,
  at        TEXT NOT NULL,
  actor     TEXT NOT NULL,               -- email o 'system:cron'
  action    TEXT NOT NULL,
  entity    TEXT NOT NULL,
  entity_id TEXT,
  details   TEXT                         -- JSON, sin secretos
);
CREATE INDEX audit_log_entity ON audit_log(entity, entity_id);
