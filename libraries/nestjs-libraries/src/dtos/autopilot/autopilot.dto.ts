import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class AutopilotDto {
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  integrations: string[];

  // Capped at 21 (three a day). Beyond that the limit stops being a schedule
  // and starts being a way to get an account rate-limited.
  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(21)
  postsPerWeek?: number;

  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(60)
  horizonDays?: number;

  @IsArray()
  @IsOptional()
  @ArrayMaxSize(12)
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    each: true,
    message: 'Each slot must be a time like 09:30.',
  })
  slots?: string[];

  @IsArray()
  @IsOptional()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  topics?: string[];

  @IsBoolean()
  @IsOptional()
  autoApprove?: boolean;

  /** 0 means no ceiling — an explicit choice the operator has to make. */
  @IsInt()
  @IsOptional()
  @Min(0)
  weeklyCreditCap?: number;
}
