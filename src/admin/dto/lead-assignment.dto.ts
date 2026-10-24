import { ApiProperty } from '@nestjs/swagger';
import { loginOf } from '../../common/utils/login-of';
import { TraderLead } from '../../users/entities/trader-lead.entity';

export class LeadAssignmentDto {
  @ApiProperty({ format: 'uuid' })
  leadUserId: string;

  @ApiProperty()
  login: string;

  @ApiProperty()
  currencyId: number;

  @ApiProperty({ example: 'RUB' })
  currency: string;

  @ApiProperty()
  payInPercent: number;

  @ApiProperty()
  payOutPercent: number;
}

export const toLeadAssignmentDto = (link: TraderLead): LeadAssignmentDto => ({
  leadUserId: link.leadUserId,
  login: loginOf(link.lead),
  currencyId: link.currencyId,
  currency: link.currency.isocode,
  payInPercent: link.payInPercent,
  payOutPercent: link.payOutPercent,
});
