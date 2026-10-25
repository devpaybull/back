import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, ValidateNested } from 'class-validator';
import { AddLeadDto } from './add-lead.dto';

export class ReplaceLeadsDto {
  @ApiProperty({
    type: [AddLeadDto],
    description:
      'The trader’s whole assignment set: one row per lead × currency. Rows left out are removed; an empty list removes every lead.',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AddLeadDto)
  leads: AddLeadDto[];
}
