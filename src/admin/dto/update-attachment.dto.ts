import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { AttachmentMethodDto } from './attachment-method.dto';

export class UpdateAttachmentDto {
  @ApiPropertyOptional()
  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  trading?: boolean;

  @ApiPropertyOptional({
    type: [AttachmentMethodDto],
    description: 'merged by method; methods not named keep their switch',
  })
  @ValidateIf((_, value) => value !== undefined)
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttachmentMethodDto)
  methods?: AttachmentMethodDto[];
}
