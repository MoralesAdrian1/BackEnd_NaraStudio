-- Privacidad y seguridad (2026-11-12)

-- 1. Menos datos: la dirección de la alumna ya no se pide ni se guarda.
ALTER TABLE "students" DROP COLUMN "address";

-- 2. Menores de edad (12 a 17): datos y consentimiento de madre, padre o tutor.
ALTER TABLE "students"
  ADD COLUMN "guardian_name" TEXT,
  ADD COLUMN "guardian_phone" TEXT,
  ADD COLUMN "guardian_email" TEXT,
  ADD COLUMN "guardian_consent_at" TIMESTAMPTZ;

-- 3. Borrado de cuenta: la alumna queda anónima (sus pagos y reservas se conservan por ley).
ALTER TABLE "students" ADD COLUMN "deleted_at" TIMESTAMPTZ;

-- 4. Datos de salud cifrados en la app (AES-256-GCM). Las columnas sueltas se vacían al migrar.
ALTER TABLE "student_health" ADD COLUMN "data_enc" TEXT;

-- 5. Fotos de alumnas: el bucket deja de ser público; la app las muestra con enlaces firmados
-- que vencen en una hora.
UPDATE storage.buckets SET public = false WHERE id = 'students';

-- 6. RLS en todas las tablas (también las creadas después de la primera migración) y sin
-- permisos para la API pública de Supabase: solo el backend (dueño de las tablas) entra.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
