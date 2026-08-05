-- Ishlab chiqish uchun boshlang'ich ma'lumot. Idempotent: qayta yugurtirish xavfsiz.
-- Ishlab chiqarishda bu migratsiyani o'tkazib yuboring (SKIP_SEED=1).

INSERT INTO organizations (id, name, slug, plan, camera_limit)
VALUES (
  '00000000-0000-0000-0000-0000000000a1',
  'Demo tashkilot',
  'demo',
  'trial',
  8
)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO sites (id, org_id, name, address, timezone)
VALUES (
  '00000000-0000-0000-0000-0000000000b1',
  '00000000-0000-0000-0000-0000000000a1',
  'Markaziy do''kon',
  'Toshkent',
  'Asia/Tashkent'
)
ON CONFLICT (id) DO NOTHING;

-- Admin foydalanuvchi bu yerda yaratilmaydi: parol xeshini SQL da qattiq
-- yozish xavfli va migratsiya fayli git ga tushadi. Buning o'rniga:
--
--   npm run create-admin -- --email admin@demo.local --org demo
--
-- Skript parolni so'raydi va scrypt bilan xeshlaydi.
