import { IsBoolean, IsInt, IsISO8601, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const HHMM_MESSAGE = { message: 'La hora va como HH:MM (por ejemplo 19:00)' };

export class CreateClassDto {
  @IsString()
  @Length(2, 60)
  name!: string;

  @IsInt()
  disciplineId!: number;

  /** Si no se manda, toma el cupo de la disciplina */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  capacity?: number;

  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(240)
  durationMin?: number;

  /** Solo el admin puede crear la clase a nombre de otra coach */
  @IsOptional()
  @IsInt()
  coachId?: number;
}

export class UpdateClassDto {
  /** Solo el admin: pasar la clase (y sus próximas sesiones) a otra coach */
  @IsOptional()
  @IsInt()
  coachId?: number;

  @IsOptional()
  @IsString()
  @Length(2, 60)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  capacity?: number;

  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(240)
  durationMin?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateScheduleDto {
  /** 0 = domingo … 6 = sábado */
  @IsInt()
  @Min(0)
  @Max(6)
  weekday!: number;

  @Matches(HHMM, HHMM_MESSAGE)
  startTime!: string;

  /** Desde cuándo aplica (AAAA-MM-DD). Por defecto, hoy. */
  @IsOptional()
  @IsISO8601({ strict: true })
  validFrom?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  validUntil?: string;
}

/** Clase suelta en un horario nuevo */
export class CreateSessionDto {
  @IsInt()
  classId!: number;

  @IsISO8601({ strict: true })
  date!: string;

  @Matches(HHMM, HHMM_MESSAGE)
  startTime!: string;

  /** Suplente: solo el admin puede asignar otra coach */
  @IsOptional()
  @IsInt()
  coachId?: number;
}

export class CancelSessionDto {
  @IsString()
  @Length(3, 200)
  reason!: string;
}

export class ListSessionsQuery {
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;
}

export class CreateClosureDto {
  @IsISO8601({ strict: true })
  date!: string;

  @IsString()
  @Length(3, 120)
  reason!: string;
}
