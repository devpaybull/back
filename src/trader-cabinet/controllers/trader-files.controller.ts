import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import { WriteAccessGuard } from '../../common/guards/write-access.guard';
import { AuthenticatedUser } from '../../common/types/token';
import { attachmentDisposition } from '../../common/utils/attachment-disposition';
import { TransactionFilesService } from '../../transactions/services/transaction-files.service';

@ApiTags('Trader · Pay-outs')
@ApiBearerAuth()
@UseGuards(RolesGuard, WriteAccessGuard)
@Roles(Role.Trader)
@Controller('trader/files')
export class TraderFilesController {
  constructor(private readonly files: TransactionFilesService) {}

  @Get(':id')
  @ApiOperation({
    summary: 'Downloads a file of the trader’s own deal',
    description: 'Always an attachment. A file of any other deal is a 404.',
  })
  @ApiOkResponse({ description: 'The file, not wrapped in the envelope' })
  async download(
    @CurrentUser() trader: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<StreamableFile> {
    const { file, body } = await this.files.downloadForTrader(trader.id, id);

    return new StreamableFile(body, {
      type: file.mime,
      disposition: attachmentDisposition(file.name),
    });
  }
}
