import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';

/** Dar de alta como coach a una cuenta que ya se registró en la app. */
export class PromoteCoachDto {
  @IsEmail({}, { message: 'Escribe un correo válido' })
  email!: string;

  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(10)
  @IsInt({ each: true })
  disciplineIds!: number[];
}

export class UpdateCoachDto {
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(10)
  @IsInt({ each: true })
  disciplineIds?: number[];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** Lo que cada coach edita de su perfil público. */
export class UpdateMyCoachDto {
  @IsOptional()
  @IsString()
  @MaxLength(600)
  bio?: string;

  @IsOptional()
  @Matches(/^[A-Za-z0-9._]{1,30}$/, { message: 'Instagram: solo el usuario, sin @ ni enlace' })
  instagram?: string;

  @IsOptional()
  @Matches(/^[A-Za-z0-9._]{1,30}$/, { message: 'TikTok: solo el usuario, sin @ ni enlace' })
  tiktok?: string;

  /** Ruta en el bucket "coaches" (su carpeta) */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  photoPath?: string;
}

export class CreateCertificationDto {
  @IsString()
  @Length(2, 120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  issuer?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  issuedAt?: string;

  /** PDF ya subido al bucket "coaches" (su carpeta) */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  filePath?: string;
}
