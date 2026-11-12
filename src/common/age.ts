import { BadRequestException } from '@nestjs/common';

/** Edad mínima para tener cuenta y edad a partir de la cual ya no se pide tutor. */
export const MIN_AGE = 12;
export const ADULT_AGE = 18;

/** Años cumplidos a la fecha (birthDate en AAAA-MM-DD o Date de una columna DATE). */
export function ageOn(birthDate: string | Date, today = new Date()): number {
  const iso = typeof birthDate === 'string' ? birthDate : birthDate.toISOString().slice(0, 10);
  const [y, m, d] = iso.split('-').map(Number);
  const local = new Date(today.toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));
  let age = local.getFullYear() - y;
  if (local.getMonth() + 1 < m || (local.getMonth() + 1 === m && local.getDate() < d)) age--;
  return age;
}

export const isMinor = (birthDate: string | Date | null | undefined) => !!birthDate && ageOn(birthDate) < ADULT_AGE;

/** Rechaza fechas imposibles y a menores de 12 años. */
export function assertAllowedAge(birthDate: string) {
  const age = ageOn(birthDate);
  if (age > 110 || Date.parse(birthDate) > Date.now()) throw new BadRequestException('Revisa tu fecha de nacimiento');
  if (age < MIN_AGE) throw new BadRequestException(`Para tener una cuenta necesitas tener al menos ${MIN_AGE} años`);
  return age;
}
