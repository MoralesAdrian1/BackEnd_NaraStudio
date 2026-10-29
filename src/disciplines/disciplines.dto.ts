import { IsBoolean, IsInt, IsOptional, IsString, Length, Matches, Max, MaxLength, Min } from 'class-validator';

export class CreateDisciplineDto {
  @IsString()
  @Length(2, 60)
  name!: string;

  @Matches(/^[a-z0-9-]{2,40}$/, { message: 'El identificador solo lleva minúsculas, números y guiones' })
  slug!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @IsInt()
  @Min(1)
  @Max(100)
  defaultCapacity!: number;
}

export class UpdateDisciplineDto {
  @IsOptional()
  @IsString()
  @Length(2, 60)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  defaultCapacity?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
