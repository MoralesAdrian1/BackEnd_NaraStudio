// Carga los planes del estudio con su reparto. No duplica: se salta los que ya existen por nombre.
// Barre es del admin (head coach); Trampolín, de la primera coach de trampolín; el ilimitado, 50 / 50.
// Uso: npm run db:seed-plans
import pg from 'pg'

const WEEKDAYS = [1, 2, 3, 4, 5]
// [nombre, tipo, precio en pesos, créditos (null = ilimitados), días, cobro automático, disciplinas]
const PLANS = [
  ['Mes Barre', 'monthly', 700, null, 30, true, ['barre']],
  ['12 clases Barre', 'pack', 500, 12, 30, false, ['barre']],
  ['Clase individual Barre', 'single_class', 90, 1, 1, false, ['barre']],
  ['Mes Trampolín', 'monthly', 500, null, 30, true, ['trampolin']],
  ['Semana Trampolín', 'weekly', 180, 5, 7, false, ['trampolin']],
  ['Clase individual Trampolín', 'single_class', 70, 1, 1, false, ['trampolin']],
  ['Ilimitado Barre + Trampolín', 'monthly', 900, null, 30, true, ['barre', 'trampolin']],
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
  // Quién imparte cada disciplina (la head coach para barre)
  const owner = async (slug, role) =>
    one(
      `SELECT c.id AS coach_id, d.id AS discipline_id FROM coaches c
       JOIN profiles p ON p.id = c.profile_id
       JOIN coach_disciplines cd ON cd.coach_id = c.id
       JOIN disciplines d ON d.id = cd.discipline_id
       WHERE d.slug = $1 AND p.role = $2 AND c.is_active ORDER BY c.id LIMIT 1`,
      [slug, role],
    )
  const owners = { barre: await owner('barre', 'admin'), trampolin: await owner('trampolin', 'coach') }
  if (!owners.barre || !owners.trampolin) throw new Error('Faltan coaches: asigna roles con npm run auth:role')

  let added = 0
  for (const [name, kind, pesos, credits, days, autoRenew, slugs] of PLANS) {
    if (await one(`SELECT 1 FROM plans WHERE name = $1`, [name])) continue
    const createdBy = slugs.length > 1 ? owners.barre.coach_id : owners[slugs[0]].coach_id
    const plan = await one(
      `INSERT INTO plans (name, kind, price_cents, credits, duration_days, training_days, allows_auto_renew, created_by_id, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now()) RETURNING id`,
      [name, kind, pesos * 100, credits, days, WEEKDAYS, autoRenew, createdBy],
    )
    const bp = 10000 / slugs.length
    for (const slug of slugs) {
      await client.query(
        `INSERT INTO plan_revenue_shares (plan_id, discipline_id, coach_id, basis_points) VALUES ($1, $2, $3, $4)`,
        [plan.id, owners[slug].discipline_id, owners[slug].coach_id, bp],
      )
    }
    added++
  }
  await client.query('COMMIT')
  console.log(`Planes nuevos: ${added} de ${PLANS.length}.`)
} catch (e) {
  await client.query('ROLLBACK')
  console.error(e.message)
  process.exitCode = 1
} finally {
  await client.end()
}
