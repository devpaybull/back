import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsUUID, ValidateNested } from 'class-validator';
import { AttachmentMethodDto } from './attachment-method.dto';

export class AttachmentEntryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  userId: string;

  @ApiProperty({ description: 'the «Торговля» switch of the pair' })
  @IsBoolean()
  trading: boolean;

  @ApiProperty({
    type: [AttachmentMethodDto],
    description: 'one switch per method; a method left out is off',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttachmentMethodDto)
  methods: AttachmentMethodDto[];
}
