-- Retention siyosati va analitika uchun oldindan hisoblangan agregatlar.

-- ---------------------------------------------------------------------------
-- Continuous aggregates
-- ---------------------------------------------------------------------------
-- /analytics sahifasi millionlab qatorni skanerlamasligi uchun soatlik
-- agregatlar TimescaleDB tomonidan avtomatik yangilanadi.

CREATE MATERIALIZED VIEW events_hourly
WITH (timescaledb.continuous) AS
SELECT
  time_bucket(INTERVAL '1 hour', confirmed_at) AS bucket,
  org_id,
  camera_id,
  type,
  severity,
  count(*)                                          AS event_count,
  count(*) FILTER (WHERE status = 'false_positive') AS false_positive_count,
  avg(confidence)                                   AS avg_confidence
FROM events
GROUP BY bucket, org_id, camera_id, type, severity
WITH NO DATA;

SELECT add_continuous_aggregate_policy('events_hourly',
  start_offset => INTERVAL '3 days',
  end_offset   => INTERVAL '1 hour',
  schedule_interval => INTERVAL '30 minutes');

CREATE MATERIALIZED VIEW demographics_hourly
WITH (timescaledb.continuous) AS
SELECT
  time_bucket(INTERVAL '1 hour', last_seen_at) AS bucket,
  org_id,
  camera_id,
  gender,
  age_bucket,
  count(*)          AS people_count,
  avg(dwell_seconds) AS avg_dwell_seconds
FROM person_sightings
-- Past ishonchli o'lchovlar agregatga kirmaydi: ular statistikani buzadi.
WHERE samples >= 3
GROUP BY bucket, org_id, camera_id, gender, age_bucket
WITH NO DATA;

SELECT add_continuous_aggregate_policy('demographics_hourly',
  start_offset => INTERVAL '3 days',
  end_offset   => INTERVAL '1 hour',
  schedule_interval => INTERVAL '30 minutes');

-- ---------------------------------------------------------------------------
-- Retention
-- ---------------------------------------------------------------------------
-- Shaxsga doir ma'lumotni cheksiz saqlash huquqiy risk. Xom sightings
-- 30 kundan keyin o'chiriladi, agregatlar esa qoladi (ular anonim).
--
-- Eventlarning o'zi uzoqroq saqlanadi, ammo ularga bog'langan media
-- (snapshot va klip) MinIO dan event-service tomonidan o'chiriladi -
-- MEDIA_RETENTION_DAYS ga qarang.

SELECT add_retention_policy('person_sightings', INTERVAL '30 days');
SELECT add_retention_policy('events', INTERVAL '180 days');

-- Eski chunk larni siqish: 7 kundan keyin disk 5-10 barobar tejaladi.
ALTER TABLE events SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'camera_id, type',
  timescaledb.compress_orderby = 'confirmed_at DESC'
);

SELECT add_compression_policy('events', INTERVAL '7 days');
