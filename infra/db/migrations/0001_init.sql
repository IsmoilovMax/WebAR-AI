-- Bazaviy sxema: multi-tenant ildizi, kameralar, zonalar, foydalanuvchilar.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------------

CREATE TABLE organizations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  slug          text NOT NULL UNIQUE,
  plan          text NOT NULL DEFAULT 'trial'
                CHECK (plan IN ('trial', 'starter', 'business', 'enterprise')),
  camera_limit  integer NOT NULL DEFAULT 4 CHECK (camera_limit >= 0),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sites (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name       text NOT NULL,
  address    text,
  timezone   text NOT NULL DEFAULT 'Asia/Tashkent',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sites_org_idx ON sites (org_id);

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  name          text NOT NULL DEFAULT '',
  password_hash text NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX users_email_key ON users (lower(email));

-- Bitta foydalanuvchi bir nechta tashkilotga a'zo bo'la oladi (integrator
-- bir nechta mijozni boshqaradi). Rol har bir a'zolikda alohida.
CREATE TABLE memberships (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('owner', 'manager', 'operator', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, org_id)
);

CREATE INDEX memberships_org_idx ON memberships (org_id);

CREATE TABLE sessions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sessions_expiry_idx ON sessions (expires_at);

-- ---------------------------------------------------------------------------
-- Edge tugunlari va kameralar
-- ---------------------------------------------------------------------------

-- Har bir obyektdagi AI server. Gibrid rejimda cloud dashboard bir nechta
-- edge tugunni ko'radi.
CREATE TABLE edge_nodes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id       uuid REFERENCES sites(id) ON DELETE SET NULL,
  name          text NOT NULL,
  api_key_hash  text NOT NULL UNIQUE,
  agent_version text,
  gpu_name      text,
  last_seen_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX edge_nodes_org_idx ON edge_nodes (org_id);

CREATE TABLE cameras (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  site_id            uuid REFERENCES sites(id) ON DELETE SET NULL,
  edge_node_id       uuid REFERENCES edge_nodes(id) ON DELETE SET NULL,
  name               text NOT NULL,
  host               text NOT NULL,
  rtsp_port          integer NOT NULL DEFAULT 554 CHECK (rtsp_port BETWEEN 1 AND 65535),
  isapi_port         integer NOT NULL DEFAULT 80 CHECK (isapi_port BETWEEN 1 AND 65535),
  channel            integer NOT NULL DEFAULT 1 CHECK (channel BETWEEN 1 AND 64),
  username           text NOT NULL,
  -- AES-256-GCM bilan shifrlangan parol. Kalit CREDENTIALS_ENCRYPTION_KEY da,
  -- bazada emas. Baza o'g'irlansa ham kamera credentials ochilmaydi.
  password_encrypted text NOT NULL,
  enabled_detectors  text[] NOT NULL DEFAULT ARRAY['person']::text[],
  analytics_fps      numeric(4, 1) NOT NULL DEFAULT 6 CHECK (analytics_fps BETWEEN 1 AND 30),
  enabled            boolean NOT NULL DEFAULT true,
  status             text NOT NULL DEFAULT 'offline'
                     CHECK (status IN ('online', 'offline', 'degraded', 'disabled')),
  status_reason      text,
  last_seen_at       timestamptz,
  -- ISAPI orqali aniqlangan qurilma ma'lumotlari (model, firmware, rezolyutsiya).
  device_info        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, host, channel)
);

CREATE INDEX cameras_org_idx ON cameras (org_id) WHERE enabled;
CREATE INDEX cameras_edge_idx ON cameras (edge_node_id);

CREATE TABLE detection_zones (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  camera_id  uuid NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
  name       text NOT NULL,
  kind       text NOT NULL CHECK (kind IN ('include', 'exclude', 'no_smoking', 'restricted')),
  -- [[x, y], ...] normallashtirilgan (0..1) poligon. Kamera rezolyutsiyasi
  -- o'zgarsa ham zona joyida qoladi.
  polygon    jsonb NOT NULL,
  detectors  text[] NOT NULL DEFAULT ARRAY[]::text[],
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX detection_zones_camera_idx ON detection_zones (camera_id);

-- ---------------------------------------------------------------------------
-- Model registry
-- ---------------------------------------------------------------------------

CREATE TABLE model_versions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid REFERENCES organizations(id) ON DELETE CASCADE,
  detector          text NOT NULL,
  version           text NOT NULL,
  -- Roboflow loyihasi va versiyasi, qayta o'qitishni kuzatish uchun.
  roboflow_project  text,
  roboflow_version  integer,
  artifact_path     text NOT NULL,
  format            text NOT NULL DEFAULT 'onnx'
                    CHECK (format IN ('pt', 'onnx', 'engine', 'tflite')),
  metrics           jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active         boolean NOT NULL DEFAULT false,
  deployed_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (detector, version)
);

CREATE UNIQUE INDEX model_versions_active_idx
  ON model_versions (detector, COALESCE(org_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE is_active;

-- ---------------------------------------------------------------------------
-- Alertlar
-- ---------------------------------------------------------------------------

CREATE TABLE alert_rules (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name             text NOT NULL,
  event_types      text[] NOT NULL,
  min_severity     text NOT NULL DEFAULT 'medium'
                   CHECK (min_severity IN ('info', 'low', 'medium', 'high', 'critical')),
  -- Bo'sh massiv = tashkilotdagi barcha kameralar.
  camera_ids       uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  target           jsonb NOT NULL,
  active_from      time,
  active_to        time,
  cooldown_seconds integer NOT NULL DEFAULT 300 CHECK (cooldown_seconds >= 0),
  enabled          boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX alert_rules_org_idx ON alert_rules (org_id) WHERE enabled;

-- Cooldown va yetkazib berish tarixini kuzatish. Bir xil qoida + kamera
-- juftligi uchun oxirgi yuborilgan vaqt shu yerdan olinadi.
CREATE TABLE alert_deliveries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  rule_id       uuid NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  camera_id     uuid NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
  event_id      uuid NOT NULL,
  event_type    text NOT NULL,
  status        text NOT NULL CHECK (status IN ('sent', 'failed', 'suppressed')),
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX alert_deliveries_cooldown_idx
  ON alert_deliveries (rule_id, camera_id, event_type, created_at DESC);

-- ---------------------------------------------------------------------------
-- Audit
-- ---------------------------------------------------------------------------

-- Kim qaysi videoni ko'rdi / qaysi sozlamani o'zgartirdi. Biometrik
-- ma'lumot bilan ishlaganda bu huquqiy talab.
CREATE TABLE audit_log (
  id           bigserial PRIMARY KEY,
  org_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  action       text NOT NULL,
  resource     text NOT NULL,
  resource_id  text,
  ip_address   inet,
  user_agent   text,
  detail       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_org_time_idx ON audit_log (org_id, created_at DESC);
