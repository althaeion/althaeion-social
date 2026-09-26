import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { BRAND_VOICE_TRAITS } from '@gitroom/nestjs-libraries/database/prisma/brand/brand.voice';

export class BrandProfileDto {
  @IsString()
  @IsOptional()
  @MaxLength(120)
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2048)
  website?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  description?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  audience?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  tone?: string;

  @IsArray()
  @IsOptional()
  @ArrayMaxSize(20)
  @IsIn(BRAND_VOICE_TRAITS, { each: true })
  voice?: string[];

  @IsString()
  @IsOptional()
  @MaxLength(5)
  language?: string;

  @IsArray()
  @IsOptional()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  colors?: string[];

  @IsArray()
  @IsOptional()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  keywords?: string[];

  @IsArray()
  @IsOptional()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  avoid?: string[];
}

export class BrandAnalyzeDto {
  @IsString()
  @MaxLength(2048)
  website: string;
}
