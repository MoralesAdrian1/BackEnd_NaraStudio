import {
  Equals,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

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
  @Length(8, 20)
  phone?: string;

  /** AAAA-MM-DD */
  @IsOptional()
  @IsISO8601({ strict: true })
  birthDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  address?: string;

  /** Foto de la alumna: ruta en el bucket students (dentro de su carpeta) */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  photoPath?: string;
}

/** Datos sensibles: solo se guardan con consentimiento explícito. */
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
