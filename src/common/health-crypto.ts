import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Cifrado de los datos de salud (datos sensibles, LFPDPPP) con AES-256-GCM.
 * La llave va en HEALTH_DATA_KEY: 32 bytes en base64 (`openssl rand -base64 32`).
 * Formato guardado: v1.<iv>.<tag>.<datos>, todo en base64url.
 */
export interface HealthData {
  weightKg: number | null;
  heightCm: number | null;
  specialConditions: string | null;
}

/** Columnas de student_health que se leen para descifrar. */
export interface HealthRow {
  dataEnc: string | null;
  weightKg: unknown;
  heightCm: number | null;
  specialConditions: string | null;
}

let cachedKey: Buffer | null = null;

function key(): Buffer {
  if (cachedKey) return cachedKey;
  const raw = process.env.HEALTH_DATA_KEY;
  if (!raw) throw new Error('Falta HEALTH_DATA_KEY en el servidor (llave para cifrar los datos de salud)');
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) throw new Error('HEALTH_DATA_KEY debe ser de 32 bytes en base64');
  cachedKey = buf;
  return buf;
}

export function encryptHealth(data: HealthData): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  return ['v1', iv, cipher.getAuthTag(), body].map((p) => (typeof p === 'string' ? p : p.toString('base64url'))).join('.');
}

function decrypt(value: string): HealthData {
  const [version, iv, tag, body] = value.split('.');
  if (version !== 'v1' || !iv || !tag || !body) throw new Error('Datos de salud con formato desconocido');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  const json = Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
  return JSON.parse(json) as HealthData;
}

/** Datos de salud en claro. Lee el cifrado y, si es un registro viejo, las columnas sueltas. */
export function readHealth(row: HealthRow): HealthData {
  if (row.dataEnc) return decrypt(row.dataEnc);
  return {
    weightKg: row.weightKg == null ? null : Number(row.weightKg),
    heightCm: row.heightCm,
    specialConditions: row.specialConditions,
  };
}

/** Lo que se escribe en student_health: todo cifrado y las columnas sueltas vacías. */
export function sealHealth(data: HealthData) {
  return { dataEnc: encryptHealth(data), weightKg: null, heightCm: null, specialConditions: null };
}
