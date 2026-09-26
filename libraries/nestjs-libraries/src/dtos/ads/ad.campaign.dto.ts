import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDefined,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  AD_ANGLES,
  AD_OBJECTIVES,
  FUNNEL_STAGES,
} from '@gitroom/nestjs-libraries/database/prisma/ads/ads.generator';

export class AdCampaignDto {
  @IsString()
  @IsDefined()
  @MaxLength(120)
  name: string;

  @IsString()
  @IsIn(AD_OBJECTIVES as unknown as string[])
  objective: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  product?: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  audience?: string;

  @IsString()
  @IsOptional()
  @MaxLength(1000)
  offer?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @IsString({ each: true })
  platforms: string[];

  @IsArray()
  @IsOptional()
  @IsIn(Object.keys(AD_ANGLES), { each: true })
  angles?: string[];

  @IsArray()
  @IsOptional()
  @IsIn(Object.keys(FUNNEL_STAGES), { each: true })
  stages?: string[];

  // Capped at 2: the matrix is platforms x angles x stages already, and a third
  // copy of each combination costs tokens without testing anything new.
  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(2)
  perCombination?: number;
}

export class ScheduleVariantsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  variantIds: string[];

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  integrationIds: string[];

  @IsString()
  @IsOptional()
  startAt?: string;

  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(720)
  everyHours?: number;
}
