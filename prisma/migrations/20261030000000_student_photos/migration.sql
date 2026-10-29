-- Foto de perfil de las alumnas. En la base solo se guarda la ruta; la imagen (WEBP chica,
-- comprimida en el navegador) vive en Supabase Storage.
ALTER TABLE "students" ADD COLUMN "photo_path" TEXT;

-- Bucket público: las coaches ven la foto en la lista de la clase. Máximo 1 MB.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('students', 'students', true, 1048576, ARRAY['image/webp', 'image/jpeg'])
ON CONFLICT (id) DO NOTHING;

-- Cada cuenta sube y borra solo dentro de su carpeta (su id de Supabase Auth)
CREATE POLICY "alumnas suben a su carpeta"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'students'
  AND (storage.foldername(name))[1] = (SELECT auth.jwt() ->> 'sub')
);

CREATE POLICY "alumnas borran de su carpeta"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'students'
  AND (storage.foldername(name))[1] = (SELECT auth.jwt() ->> 'sub')
);
