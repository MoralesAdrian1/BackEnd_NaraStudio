import {
  Equals,
  IsEmail,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const PHONE = /^[0-9+()\s-]{8,20}$/;

export class UpdateMeDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  fullName?: string;

  @IsOptional()
  @IsString()
  @Length(2, 40)
  publicName?: string;

  @IsOptional()
  @IsString()
  @Matches(PHONE, { message: 'Escribe un celular válido' })
  phone?: string;

  /** AAAA-MM-DD */
  @IsOptional()
  @IsISO8601({ strict: true })
  birthDate?: string;

  /** Foto de la alumna: ruta en el bucket students (dentro de su carpeta) */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Matches(/^[0-9a-f-]{36}\/[\w.-]+$/, { message: 'Ruta de foto inválida' })
  photoPath?: string;

  /** Acepta los términos y el aviso de privacidad vigentes; solo se puede aceptar, no deshacer */
  @IsOptional()
  @Equals(true, { message: 'Para continuar acepta los términos y el aviso de privacidad' })
  acceptTerms?: boolean;

  // ─── Menores de 18: madre, padre o tutor ───
  @IsOptional()
  @IsString()
  @Length(2, 120)
  guardianName?: string;

  @IsOptional()
  @IsString()
  @Matches(PHONE, { message: 'Escribe un celular válido para tu madre, padre o tutor' })
  guardianPhone?: string;

  @IsOptional()
  @IsEmail({}, { message: 'Escribe un correo válido para tu madre, padre o tutor' })
  @MaxLength(200)
  guardianEmail?: string;

  /** Tu madre, padre o tutor autoriza el registro y el tratamiento de tus datos */
  @IsOptional()
  @Equals(true, { message: 'Se necesita la autorización de tu madre, padre o tutor' })
  guardianConsent?: boolean;
}

/** Datos sensibles: solo se guardan con consentimiento explícito. Todo es opcional. */
export class UpdateHealthDto {
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(20)
  @Max(300)
  weightKg?: number;

  @IsOptional()
  @IsInt()
  @Min(80)
  @Max(250)
  heightCm?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  specialConditions?: string;

  @Equals(true, { message: 'Se necesita el consentimiento para guardar datos de salud' })
  consent!: boolean;
}

/** Para borrar la cuenta hay que escribir el correo, así no se borra por accidente. */
export class DeleteMeDto {
  @IsEmail()
  @MaxLength(200)
  confirmEmail!: string;
}
