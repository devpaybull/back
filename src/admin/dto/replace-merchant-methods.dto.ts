import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, ValidateNested } from 'class-validator';
import { MerchantMethodEntryDto } from './merchant-method-entry.dto';

export class ReplaceMerchantMethodsDto {
  @ApiProperty({
    type: [MerchantMethodEntryDto],
    description: 'the whole set; a method left out is off in both directions',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MerchantMethodEntryDto)
  methods: MerchantMethodEntryDto[];
}
