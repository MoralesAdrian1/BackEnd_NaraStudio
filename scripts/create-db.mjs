// Crea la base de datos de DATABASE_URL si todavía no existe.
import pg from 'pg'

const url = new URL(process.env.DATABASE_URL)
const dbName = url.pathname.slice(1)
url.pathname = '/postgres'

const client = new pg.Client({ connectionString: url.toString() })
await client.connect()
const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName])
if (rowCount) {
  console.log(`La base de datos "${dbName}" ya existe`)
} else {
  await client.query(`CREATE DATABASE "${dbName}"`)
  console.log(`Base de datos "${dbName}" creada`)
}
await client.end()
