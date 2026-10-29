import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class WeekQuery {
  /** Cualquier día de la semana (AAAA-MM-DD); por defecto, la semana en curso */
  @IsOptional()
  @IsISO8601({ strict: true })
  start?: string;
}

export class SettlementPaymentDto {
  @IsInt()
  fromCoachId!: number;

  @IsInt()
  toCoachId!: number;

  @IsInt()
  @Min(1)
  @Max(10_000_000)
  amountCents!: number;

  @IsIn(['cash', 'transfer'])
  method!: 'cash' | 'transfer';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  notes?: string;
}
