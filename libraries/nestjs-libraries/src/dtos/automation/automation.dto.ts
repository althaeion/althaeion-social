import {
  ArrayMaxSize,
  IsArray,
  IsDefined,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AUTOMATION_LIMITS } from '@gitroom/nestjs-libraries/automation/automation.types';

const NODE_TYPES = [
  'TRIGGER',
  'GENERATE',
  'DELAY',
  'CONDITION',
  'PUBLISH',
  'WEBHOOK',
  'END',
  'FETCH_RSS',
  'HTTP_REQUEST',
];

export class AutomationNodeDto {
  @IsString()
  @IsDefined()
  @MaxLength(64)
  id: string;

  @IsString()
  @IsIn(NODE_TYPES)
  type: string;

  @IsObject()
  @IsOptional()
  config?: Record<string, any>;

  @IsObject()
  @IsOptional()
  position?: { x: number; y: number };

  @IsString()
  @IsOptional()
  @MaxLength(120)
  label?: string;
}

export class AutomationEdgeDto {
  @IsString()
  @IsDefined()
  @MaxLength(64)
  id: string;

  @IsString()
  @IsDefined()
  @MaxLength(64)
  source: string;

  @IsString()
  @IsDefined()
  @MaxLength(64)
  target: string;

  @IsString()
  @IsOptional()
  @IsIn(['yes', 'no'])
  handle?: string;
}

export class AutomationDto {
  @IsString()
  @IsDefined()
  @MaxLength(120)
  name: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @IsString()
  @IsIn(['SCHEDULE', 'POST_PUBLISHED', 'POST_SCHEDULED'])
  triggerType: any;

  @IsObject()
  @IsOptional()
  triggerConfig?: Record<string, any>;

  @IsArray()
  @ArrayMaxSize(AUTOMATION_LIMITS.MAX_NODES)
  @ValidateNested({ each: true })
  @Type(() => AutomationNodeDto)
  nodes: AutomationNodeDto[];

  @IsArray()
  // A graph can hold more edges than nodes, but not without bound: the cap
  // keeps a hand-crafted payload from becoming an O(n²) walk in the engine.
  @ArrayMaxSize(AUTOMATION_LIMITS.MAX_NODES * 3)
  @ValidateNested({ each: true })
  @Type(() => AutomationEdgeDto)
  edges: AutomationEdgeDto[];
}
