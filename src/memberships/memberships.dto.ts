import { IsEmail, IsInt, IsISO8601, IsOptional, IsString, Length, MaxLength } from 'class-validator';

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

export class StudentsQuery {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  q?: string;
}
