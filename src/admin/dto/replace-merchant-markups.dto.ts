import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, ValidateNested } from 'class-validator';
import { MerchantMarkupDto } from './merchant-markup.dto';

export class ReplaceMerchantMarkupsDto {
  @ApiProperty({
    type: [MerchantMarkupDto],
    description:
      'the whole set; a merchant currency left out gets a zero markup in both directions',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MerchantMarkupDto)
  markups: MerchantMarkupDto[];
}
