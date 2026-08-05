-- Eventlar va demografiya: vaqt qatorlari, TimescaleDB hypertable sifatida.

CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE events (
  id             uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  camera_id      uuid NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
  zone_id        uuid REFERENCES detection_zones(id) ON DELETE SET NULL,
  type           text NOT NULL,
  severity       text NOT NULL
                 CHECK (severity IN ('info', 'low', 'medium', 'high', 'critical')),
  status         text NOT NULL DEFAULT 'new'
                 CHECK (status IN ('new', 'acknowledged', 'resolved', 'false_positive')),
  -- Worker tomonidan yaratiladi. Worker qayta ishga tushsa yoki Redis xabarni
  -- ikki marta yetkazsa, dublikat yozilmaydi.
  event_key      text NOT NULL,
  started_at     timestamptz NOT NULL,
  confirmed_at   timestamptz NOT NULL,
  confidence     real NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  track_id       integer,
  bbox           real[4],
  attributes     jsonb,
  model_versions jsonb NOT NULL DEFAULT '{}'::jsonb,
  meta           jsonb NOT NULL DEFAULT '{}'::jsonb,
  snapshot_key   text,
  clip_key       text,
  acknowledged_by uuid REFERENCES users(id) ON DELETE SET NULL,
  acknowledged_at timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  -- Hypertable da har qanday unique indeks partitsiya ustunini o'z ichiga
  -- olishi shart, shuning uchun PK ga confirmed_at qo'shilgan.
  PRIMARY KEY (confirmed_at, id)
);

SELECT create_hypertable('events', by_range('confirmed_at', INTERVAL '7 days'));

CREATE UNIQUE INDEX events_dedupe_idx ON events (event_key, confirmed_at);
CREATE INDEX events_org_time_idx ON events (org_id, confirmed_at DESC);
CREATE INDEX events_camera_time_idx ON events (camera_id, confirmed_at DESC);
CREATE INDEX events_type_time_idx ON events (org_id, type, confirmed_at DESC);
CREATE INDEX events_open_idx ON events (org_id, confirmed_at DESC) WHERE status = 'new';

-- Odam atributlari eventdan alohida: bir odam bo'yicha bitta yozuv, u
-- hech qanday hodisa keltirib chiqarmagan bo'lsa ham (analitika uchun).
--
-- MUHIM: bu yerda yuz tasviri ham, yuz embeddingi ham SAQLANMAYDI. Faqat
-- agregat atribut va vaqtinchalik track_id. Bu qasddan qilingan cheklov:
-- embedding saqlansa, tizim biometrik identifikatsiya tizimiga aylanadi va
-- butunlay boshqa huquqiy rejimga tushadi.
CREATE TABLE person_sightings (
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  camera_id         uuid NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
  track_id          integer NOT NULL,
  first_seen_at     timestamptz NOT NULL,
  last_seen_at      timestamptz NOT NULL,
  dwell_seconds     real NOT NULL DEFAULT 0,
  gender            text NOT NULL DEFAULT 'unknown'
                    CHECK (gender IN ('male', 'female', 'unknown')),
  gender_confidence real NOT NULL DEFAULT 0,
  age_bucket        text NOT NULL DEFAULT 'unknown'
                    CHECK (age_bucket IN ('young', 'middle', 'senior', 'unknown')),
  age_confidence    real NOT NULL DEFAULT 0,
  samples           integer NOT NULL DEFAULT 0,
  PRIMARY KEY (last_seen_at, id)
);

SELECT create_hypertable('person_sightings', by_range('last_seen_at', INTERVAL '7 days'));

CREATE UNIQUE INDEX person_sightings_track_idx
  ON person_sightings (camera_id, track_id, last_seen_at);
CREATE INDEX person_sightings_org_time_idx
  ON person_sightings (org_id, last_seen_at DESC);

-- Active learning: operator "noto'g'ri signal" bosganda yoki model past
-- ishonch bilan ishlaganda kadr shu yerga tushadi va Roboflow ga yuklanadi.
CREATE TABLE training_feedback (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  camera_id     uuid NOT NULL REFERENCES cameras(id) ON DELETE CASCADE,
  event_id      uuid,
  event_type    text NOT NULL,
  detector      text NOT NULL,
  -- false_positive: operator rad etdi. true_positive: operator tasdiqladi.
  -- uncertain: model ishonchi chegara atrofida, avtomatik tanlangan.
  label         text NOT NULL CHECK (label IN ('false_positive', 'true_positive', 'uncertain')),
  confidence    real,
  snapshot_key  text NOT NULL,
  bbox          real[4],
  model_version text,
  upload_status text NOT NULL DEFAULT 'pending'
                CHECK (upload_status IN ('pending', 'uploaded', 'skipped', 'failed')),
  upload_error  text,
  uploaded_at   timestamptz,
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX training_feedback_pending_idx
  ON training_feedback (created_at) WHERE upload_status = 'pending';
CREATE INDEX training_feedback_org_idx ON training_feedback (org_id, created_at DESC);
