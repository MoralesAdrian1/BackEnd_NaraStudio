// Carga las clases y el horario semanal del estudio. Se puede correr varias veces: no duplica.
// Barre lo imparte el admin (head coach); Jump, la primera coach de trampolín.
// Uso: npm run db:seed-schedule
import pg from 'pg'

const BS = 'Barre & Sculpt', BR = 'Barre Restore', JUMP = 'Jump'
// [clase, hora, días] con 1 = lunes … 5 = viernes
const TIMETABLE = [
  [BS, '06:50', [2, 3, 5]],
  [BS, '09:15', [1, 2, 4, 5]],
  [BR, '09:15', [3]],
  [BS, '19:00', [1, 2, 3, 4]],
  [BR, '19:00', [5]],
  [JUMP, '08:00', [1, 3, 4, 5]],
  [JUMP, '18:00', [1, 2, 3, 4, 5]],
  [JUMP, '20:10', [1, 2, 3, 4]],
]

const url = new URL(process.env.DIRECT_URL ?? process.env.DATABASE_URL)
url.searchParams.delete('sslmode')
const client = new pg.Client({
  connectionString: url.toString(),
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
})
await client.connect()
const one = async (sql, params) => (await client.query(sql, params)).rows[0]

try {
  await client.query('BEGIN')
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date())

  const coachFor = async (slug, role) => {
    const row = await one(
      `SELECT c.id, d.id AS discipline_id, d.default_capacity FROM coaches c
       JOIN profiles p ON p.id = c.profile_id
       JOIN coach_disciplines cd ON cd.coach_id = c.id
       JOIN disciplines d ON d.id = cd.discipline_id
       WHERE d.slug = $1 AND p.role = $2 AND c.is_active ORDER BY c.id LIMIT 1`,
      [slug, role],
    )
    if (!row) throw new Error(`No hay ${role} activa de ${slug}. Asigna roles con npm run auth:role`)
    return row
  }
  const barre = await coachFor('barre', 'admin')
  const jump = await coachFor('trampolin', 'coach')
  const owners = { [BS]: barre, [BR]: barre, [JUMP]: jump }

  const classIds = {}
  for (const [name, owner] of Object.entries(owners)) {
    const found = await one(`SELECT id FROM classes WHERE name = $1`, [name])
    classIds[name] = found?.id ?? (await one(
      `INSERT INTO classes (name, discipline_id, coach_id, capacity, duration_min, updated_at)
       VALUES ($1, $2, $3, $4, 60, now()) RETURNING id`,
      [name, owner.discipline_id, owner.id, owner.default_capacity],
    )).id
  }

  let added = 0
  for (const [name, time, days] of TIMETABLE) {
    for (const weekday of days) {
      const exists = await one(
        `SELECT 1 FROM class_schedules WHERE class_id = $1 AND weekday = $2 AND start_time = $3
           AND (valid_until IS NULL OR valid_until >= $4)`,
        [classIds[name], weekday, time, today],
      )
      if (exists) continue
      await client.query(
        `INSERT INTO class_schedules (class_id, weekday, start_time, valid_from) VALUES ($1, $2, $3, $4)`,
        [classIds[name], weekday, time, today],
      )
      added++
    }
  }

  await client.query('COMMIT')
  console.log(`Clases: ${Object.keys(classIds).join(', ')}. Horarios nuevos: ${added}.`)
  console.log('Las sesiones se generan al arrancar el backend (o con POST /api/sessions/generate).')
} catch (e) {
  await client.query('ROLLBACK')
  console.error(e.message)
  process.exitCode = 1
} finally {
  await client.end()
}
