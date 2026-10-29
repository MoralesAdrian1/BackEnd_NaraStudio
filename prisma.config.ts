import { defineConfig } from 'prisma/config';

// Prisma ya no lee .env por su cuenta; si no existe, se usan las variables del entorno.
try {
  process.loadEnvFile();
} catch {
  // Sin .env (por ejemplo en el servidor de producción)
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Las migraciones van por la conexión directa (en Supabase, el pooler en modo sesión)
  datasource: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL },
});
