// Fechas del estudio. Las sesiones se guardan en UTC, pero los horarios se piensan en la
// hora local del estudio (America/Mexico_City). Fechas como 'AAAA-MM-DD', horas como 'HH:MM'.

export const STUDIO_TZ = 'America/Mexico_City';

const DAY_MS = 86_400_000;

/** Minutos que la zona horaria va adelante de UTC en ese instante (México: −360). */
function offsetMinutes(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  const local = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return Math.round((local - at.getTime()) / 60_000);
}

/** Fecha y hora local del estudio → instante UTC. */
export function studioDateTime(date: string, time: string, tz = STUDIO_TZ): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const asUtc = Date.UTC(y, m - 1, d, hh, mm);
  // Dos pasadas por si el cambio de horario cae justo en medio
  const first = asUtc - offsetMinutes(new Date(asUtc), tz) * 60_000;
  return new Date(asUtc - offsetMinutes(new Date(first), tz) * 60_000);
}

/** Fecha local del estudio de un instante. */
export function studioDate(at: Date, tz = STUDIO_TZ): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(at);
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
}

/** 0 = domingo … 6 = sábado */
export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** Lunes de la semana de esa fecha. */
export function weekStart(date: string): string {
  return addDays(date, -((weekdayOf(date) + 6) % 7));
}

/** Columnas @db.Date y @db.Time de Prisma llegan como Date en UTC. */
export const dateOnly = (d: Date) => d.toISOString().slice(0, 10);
export const timeOnly = (d: Date) => d.toISOString().slice(11, 16);
export const asDateColumn = (date: string) => new Date(`${date}T00:00:00Z`);
export const asTimeColumn = (time: string) => new Date(`1970-01-01T${time}:00Z`);
