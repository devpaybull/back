import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { ApiEnvelopeResponse } from '../../common/decorators/api-envelope-response.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { WriteAccess } from '../../common/decorators/write-access.decorator';
import { WriteAccessGuard } from '../../common/guards/write-access.guard';
import { AuthenticatedUser } from '../../common/types/token';
import { ChangePasswordDto } from '../dto/change-password.dto';
import { ForgotPasswordDto } from '../dto/forgot-password.dto';
import { MessageDto } from '../dto/message.dto';
import { ResetPasswordDto } from '../dto/reset-password.dto';
import { SessionDto } from '../dto/session.dto';
import { PasswordService } from '../services/password.service';
import { setRefreshCookie } from '../utils/set-refresh-cookie';

const SUCCESS: MessageDto = { message: 'success' };

@ApiTags('auth')
@Controller('auth')
export class PasswordController {
  constructor(private readonly passwords: PasswordService) {}

  @Post('password/change')
  @HttpCode(HttpStatus.OK)
  @UseGuards(WriteAccessGuard)
  @WriteAccess()
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Replaces the password, signs every other device out and re-opens this one',
  })
  @ApiEnvelopeResponse(SessionDto)
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionDto> {
    const session = await this.passwords.changePassword(user.id, dto);

    setRefreshCookie(response, session);

    return { accessToken: session.accessToken, expiresIn: session.expiresIn };
  }

  @Post('password/forgot')
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary:
      'Sends a recovery code and link; answers the same whatever the login is',
  })
  @ApiEnvelopeResponse(MessageDto, { status: HttpStatus.ACCEPTED })
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<MessageDto> {
    await this.passwords.forgotPassword(dto);

    return SUCCESS;
  }

  @Post('password/reset')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sets a new password from the login and the recovery code',
  })
  @ApiEnvelopeResponse(MessageDto)
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<MessageDto> {
    await this.passwords.resetPassword(dto);

    return SUCCESS;
  }
}
