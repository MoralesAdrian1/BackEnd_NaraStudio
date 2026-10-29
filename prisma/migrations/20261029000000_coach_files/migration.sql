-- Fotos y certificados (PDF) de las coaches en Supabase Storage.
-- Bucket público: las fotos y certificados se muestran en la landing.
-- Cada coach activa solo sube y borra archivos dentro de su carpeta (su id de Supabase Auth).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('coaches', 'coaches', true, 5242880, ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

-- Los roles anon/authenticated no leen las tablas de public; esta función, en un esquema que la
-- Data API no expone, responde solo "¿quien pregunta es una coach activa?".
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE OR REPLACE FUNCTION private.is_active_coach()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.coaches c
    WHERE c.profile_id = (SELECT auth.uid()) AND c.is_active
  );
$$;
REVOKE ALL ON FUNCTION private.is_active_coach() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.is_active_coach() TO authenticated;

CREATE POLICY "coaches suben a su carpeta"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'coaches'
  AND (storage.foldername(name))[1] = (SELECT auth.jwt() ->> 'sub')
  AND (SELECT private.is_active_coach())
);

CREATE POLICY "coaches borran de su carpeta"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'coaches'
  AND (storage.foldername(name))[1] = (SELECT auth.jwt() ->> 'sub')
);
