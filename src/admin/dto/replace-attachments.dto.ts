import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, ValidateNested } from 'class-validator';
import { AttachmentEntryDto } from './attachment-entry.dto';

export class ReplaceAttachmentsDto {
  @ApiProperty({ type: [AttachmentEntryDto] })
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => AttachmentEntryDto)
  traders: AttachmentEntryDto[];

  @ApiProperty({ type: [AttachmentEntryDto] })
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => AttachmentEntryDto)
  cascades: AttachmentEntryDto[];
}
