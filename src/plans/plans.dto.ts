import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export const PLAN_KINDS = ['monthly', 'weekly', 'pack', 'single_class'] as const;

export class ShareDto {
  @IsInt()
  disciplineId!: number;

  @IsInt()
  coachId!: number;

  /** 10000 = 100 %, 5000 = 50 % */
  @IsInt()
  @Min(1)
  @Max(10000)
  basisPoints!: number;
}

export class CreatePlanDto {
  @IsString()
  @Length(2, 80)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @IsIn(PLAN_KINDS)
  kind!: (typeof PLAN_KINDS)[number];

  @IsInt()
  @Min(0)
  @Max(10_000_000)
  priceCents!: number;

  /** Sin valor = ilimitados (la clase individual siempre es 1) */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  credits?: number;

  @IsInt()
  @Min(1)
  @Max(365)
  durationDays!: number;

  /** Días que cuentan para la racha: 0 = domingo … 6 = sábado. Por defecto, lunes a viernes. */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  trainingDays?: number[];

  @IsOptional()
  @IsBoolean()
  allowsAutoRenew?: boolean;

  /** Coach: la disciplina del plan (el dinero es 100 % suyo) */
  @IsOptional()
  @IsInt()
  disciplineId?: number;

  /** Solo admin: a quién le toca el dinero (dos disciplinas = plan combinado) */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => ShareDto)
  shares?: ShareDto[];
}

export class UpdatePlanDto {
  @IsOptional()
  @IsString()
  @Length(2, 80)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  priceCents?: number;

  @IsOptional()
  @IsBoolean()
  allowsAutoRenew?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
