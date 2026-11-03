-- Aceptación de los términos y el aviso de privacidad: qué versión y cuándo
ALTER TABLE "profiles" ADD COLUMN "terms_version" TEXT;
ALTER TABLE "profiles" ADD COLUMN "terms_accepted_at" TIMESTAMPTZ;
