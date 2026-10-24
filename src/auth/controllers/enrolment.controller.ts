import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { ApiEnvelopeResponse } from '../../common/decorators/api-envelope-response.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ConfirmRegistrationDto } from '../dto/confirm-registration.dto';
import { ConfirmTwoFactorSetupDto } from '../dto/confirm-two-factor-setup.dto';
import { RegisterDto } from '../dto/register.dto';
import {
  RegistrationStartedDto,
  SessionWithBackupCodesDto,
  TwoFactorSetupStartedDto,
} from '../dto/session.dto';
import { TwoFactorSetupDto } from '../dto/two-factor-setup.dto';
import { EnrolmentService } from '../services/enrolment.service';
import { loginContextOf } from '../utils/login-context-of';
import { setRefreshCookie } from '../utils/set-refresh-cookie';

@ApiTags('Auth')
@Public()
@Controller('auth')
export class EnrolmentController {
  constructor(private readonly enrolment: EnrolmentService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Step 1 — login, password and invite code; returns the 2FA secret',
  })
  @ApiEnvelopeResponse(RegistrationStartedDto, { status: HttpStatus.CREATED })
  register(@Body() dto: RegisterDto): Promise<RegistrationStartedDto> {
    return this.enrolment.register(dto);
  }

  @Post('register/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Step 2 — first one-time code activates the account',
  })
  @ApiEnvelopeResponse(SessionWithBackupCodesDto)
  async confirmRegistration(
    @Body() dto: ConfirmRegistrationDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionWithBackupCodesDto> {
    const { session, backupCodes } = await this.enrolment.confirmRegistration(
      dto,
      loginContextOf(request, dto.fingerprint),
    );

    setRefreshCookie(response, session);

    return {
      accessToken: session.accessToken,
      expiresIn: session.expiresIn,
      backupCodes,
    };
  }

  @Post('2fa/setup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Step 1 of re-enrolment — login and password return a fresh 2FA secret',
  })
  @ApiEnvelopeResponse(TwoFactorSetupStartedDto)
  startTwoFactorSetup(
    @Body() dto: TwoFactorSetupDto,
  ): Promise<TwoFactorSetupStartedDto> {
    return this.enrolment.startTwoFactorSetup(dto);
  }

  @Post('2fa/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Step 2 of re-enrolment — first one-time code reopens the account',
  })
  @ApiEnvelopeResponse(SessionWithBackupCodesDto)
  async confirmTwoFactorSetup(
    @Body() dto: ConfirmTwoFactorSetupDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionWithBackupCodesDto> {
    const { session, backupCodes } = await this.enrolment.confirmTwoFactorSetup(
      dto,
      loginContextOf(request, dto.fingerprint),
    );

    setRefreshCookie(response, session);

    return {
      accessToken: session.accessToken,
      expiresIn: session.expiresIn,
      backupCodes,
    };
  }
}
