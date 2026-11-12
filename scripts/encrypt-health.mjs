// Cifra los datos de salud guardados antes del cifrado (columnas sueltas de student_health)
// y vacía esas columnas. Se puede correr las veces que sea: solo toca lo que falta.
// Uso: npm run db:encrypt-health          (base de .env)
//      npm run db:encrypt-health:prod     (base de .env.produccion)
// Necesita HEALTH_DATA_KEY: la MISMA llave que usa el servidor.
import { createCipheriv, randomBytes } from 'node:crypto'
import pg from 'pg'

const key = Buffer.from(process.env.HEALTH_DATA_KEY ?? '', 'base64')
if (key.length !== 32) {
  console.error('Falta HEALTH_DATA_KEY (32 bytes en base64, la misma del servidor)')
  process.exit(1)
}

// Mismo formato que src/common/health-crypto.ts
function encrypt(data) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const body = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()])
  return ['v1', iv, cipher.getAuthTag(), body].map((p) => (typeof p === 'string' ? p : p.toString('base64url'))).join('.')
}

const url = new URL(process.env.DIRECT_URL ?? process.env.DATABASE_URL)
url.searchParams.delete('sslmode')
const client = new pg.Client({
  connectionString: url.toString(),
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
})
await client.connect()
const { rows } = await client.query(`
  SELECT student_id, weight_kg, height_cm, special_conditions FROM student_health
  WHERE data_enc IS NULL OR weight_kg IS NOT NULL OR height_cm IS NOT NULL OR special_conditions IS NOT NULL`)
let done = 0
for (const r of rows) {
  const plain = r.weight_kg !== null || r.height_cm !== null || r.special_conditions !== null
  if (!plain) continue
  const dataEnc = encrypt({
    weightKg: r.weight_kg === null ? null : Number(r.weight_kg),
    heightCm: r.height_cm,
    specialConditions: r.special_conditions,
  })
  await client.query(
    `UPDATE student_health SET data_enc = $1, weight_kg = NULL, height_cm = NULL, special_conditions = NULL WHERE student_id = $2`,
    [dataEnc, r.student_id],
  )
  done++
}
console.log(`Datos de salud cifrados: ${done}`)
await client.end()
