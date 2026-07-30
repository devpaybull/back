import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { ApiEnvelopeResponse } from '../../common/decorators/api-envelope-response.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { LoginDto } from '../dto/login.dto';
import { SessionDto } from '../dto/session.dto';
import { REFRESH_COOKIE_NAME, refreshCookieOptions } from '../refresh-cookie';
import { SessionService } from '../services/session.service';
import { readRefreshCookie } from '../utils/read-refresh-cookie';
import { setRefreshCookie } from '../utils/set-refresh-cookie';

@ApiTags('auth')
@Public()
@Controller('auth')
export class SessionController {
  constructor(private readonly sessions: SessionService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login, password and a one-time or backup code' })
  @ApiEnvelopeResponse(SessionDto)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionDto> {
    const session = await this.sessions.login(dto);

    setRefreshCookie(response, session);

    return { accessToken: session.accessToken, expiresIn: session.expiresIn };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth(REFRESH_COOKIE_NAME)
  @ApiOperation({ summary: 'Rotates the refresh cookie and issues new tokens' })
  @ApiEnvelopeResponse(SessionDto)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SessionDto> {
    const refreshToken = readRefreshCookie(request);

    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token is missing');
    }

    const session = await this.sessions.refresh(refreshToken);

    setRefreshCookie(response, session);

    return { accessToken: session.accessToken, expiresIn: session.expiresIn };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiCookieAuth(REFRESH_COOKIE_NAME)
  @ApiOperation({ summary: 'Revokes the refresh token and clears the cookie' })
  @ApiEnvelopeResponse()
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<null> {
    await this.sessions.logout(readRefreshCookie(request));

    response.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions());

    return null;
  }
}
