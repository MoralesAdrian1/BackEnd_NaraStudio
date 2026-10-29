// Asigna el rol de una cuenta de Supabase Auth y crea su perfil de coach si hace falta.
// Uso: npm run auth:role -- <email> <admin|coach|student> [disciplina...]
// Ej.:  npm run auth:role -- nadia@correo.com admin barre
//       npm run auth:role -- juana@correo.com coach trampolin
import pg from 'pg'

const [email, role, ...disciplines] = process.argv.slice(2)
if (!email || !['admin', 'coach', 'student'].includes(role)) {
  console.error('Uso: npm run auth:role -- <email> <admin|coach|student> [disciplina...]')
  process.exit(1)
}

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

  const user = await one(
    `SELECT id, email, raw_user_meta_data AS meta FROM auth.users WHERE lower(email) = lower($1)`,
    [email],
  )
  if (!user) throw new Error(`No existe una cuenta con el correo ${email} en Supabase Auth`)
  const fullName = user.meta?.full_name ?? user.meta?.name ?? user.email.split('@')[0]

  await client.query(
    `INSERT INTO profiles (id, role, full_name, email, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, updated_at = now()`,
    [user.id, role, fullName, user.email],
  )

  if (role === 'student') {
    await client.query(`UPDATE coaches SET is_active = false, updated_at = now() WHERE profile_id = $1`, [user.id])
    await client.query(
      `INSERT INTO students (profile_id, full_name, email, updated_at)
       VALUES ($1, $2, $3, now()) ON CONFLICT (profile_id) DO NOTHING`,
      [user.id, fullName, user.email],
    )
  } else {
    const coach = await one(
      `INSERT INTO coaches (profile_id, updated_at) VALUES ($1, now())
       ON CONFLICT (profile_id) DO UPDATE SET is_active = true, updated_at = now()
       RETURNING id`,
      [user.id],
    )
    for (const slug of disciplines) {
      const d = await one(`SELECT id FROM disciplines WHERE slug = $1`, [slug])
      if (!d) throw new Error(`No existe la disciplina "${slug}"`)
      await client.query(
        `INSERT INTO coach_disciplines (coach_id, discipline_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [coach.id, d.id],
      )
    }
    // Si entró primero como alumna y aún no tiene historial, se quita ese registro
    await client.query(
      `DELETE FROM students s WHERE s.profile_id = $1
         AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.student_id = s.id)
         AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.student_id = s.id)
         AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.student_id = s.id)`,
      [user.id],
    )
  }

  await client.query('COMMIT')
  console.log(`${user.email} ahora es ${role}${disciplines.length ? ` (${disciplines.join(', ')})` : ''}`)
} catch (e) {
  await client.query('ROLLBACK')
  console.error(e.message)
  process.exitCode = 1
} finally {
  await client.end()
}
