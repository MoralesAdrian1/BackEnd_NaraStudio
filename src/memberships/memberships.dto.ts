import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class CashRequestDto {
  @IsInt()
  planId!: number;

  /** Solo para la clase individual: la sesión que se compra */
  @IsOptional()
  @IsInt()
  classSessionId?: number;
}

/** La coach vende en persona y cobra en efectivo. */
export class SellDto extends CashRequestDto {
  @IsInt()
  studentId!: number;
}

/** Llegó a la clase sin plan: se le cobra la clase individual o una membresía y queda con asistencia. */
export class SellAtClassDto {
  @IsInt()
  sessionId!: number;

  @IsInt()
  planId!: number;

  @IsInt()
  studentId!: number;
}

/** Cobrar al pasar lista: la reserva que se paga. */
export class CollectDto {
  @IsInt()
  bookingId!: number;
}

/** Alumna que registra una coach: se le crea su cuenta y le llega la invitación por correo. */
export class CreateStudentDto {
  @IsString()
  @Length(2, 120)
  fullName!: string;

  @IsString()
  @Length(8, 20)
  phone!: string;

  @IsEmail({}, { message: 'Escribe un correo válido: ahí le llega la invitación' })
  email!: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  birthDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;
}

/** Una fila del Excel de carga masiva. El celular y el correo son opcionales: hay alumnas sin uno. */
export class ImportStudentRow {
  /** Fila del Excel, para decirle a la admin cuál se saltó */
  @IsOptional()
  @IsInt()
  line?: number;

  @IsString()
  @Length(2, 120)
  fullName!: string;

  @IsOptional()
  @IsString()
  @Length(8, 20)
  phone?: string;

  @IsOptional()
  @IsEmail({}, { message: 'Hay un correo que no es válido' })
  email?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  birthDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;
}

export class ImportStudentsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => ImportStudentRow)
  rows!: ImportStudentRow[];

  /** Crear su cuenta y mandarles la invitación a las que tienen correo */
  @IsBoolean()
  invite!: boolean;
}

export class StudentsQuery {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  q?: string;
}
