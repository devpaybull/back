import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelopeResponse } from '../common/decorators/api-envelope-response.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { WriteAccess } from '../common/decorators/write-access.decorator';
import { WriteAccessGuard } from '../common/guards/write-access.guard';
import { AuthenticatedUser } from '../common/types/token';
import { ConfirmEmailDto } from './dto/confirm-email.dto';
import { ProfileDto, toProfileDto } from './dto/profile.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { EmailVerificationService } from './services/email-verification.service';
import { UserDirectoryService } from './services/user-directory.service';
import { UserProfileService } from './services/user-profile.service';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(WriteAccessGuard)
@Controller('users')
export class UsersController {
  constructor(
    private readonly directory: UserDirectoryService,
    private readonly profile: UserProfileService,
    private readonly emailVerification: EmailVerificationService,
  ) {}

  @Get('me')
  @ApiOperation({ summary: 'Returns the profile of the signed-in user' })
  @ApiEnvelopeResponse(ProfileDto)
  async me(@CurrentUser() user: AuthenticatedUser): Promise<ProfileDto> {
    const current = await this.directory.findAuthenticatableById(user.id);

    if (!current) throw new UnauthorizedException();

    return toProfileDto(current);
  }

  @Patch('me')
  @WriteAccess()
  @ApiOperation({
    summary:
      'Adds the identifiers an account does not have yet: an email is written unconfirmed and mailed a code, a telegram username is written outright',
  })
  @ApiEnvelopeResponse(ProfileDto)
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
  ): Promise<ProfileDto> {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('No changes were given');
    }

    return toProfileDto(await this.profile.editOwnIdentifiers(user.id, dto));
  }

  @Post('me/email/confirm')
  @HttpCode(HttpStatus.OK)
  @WriteAccess()
  @ApiOperation({
    summary: 'Confirms the address the mailed code was issued for',
  })
  @ApiEnvelopeResponse(ProfileDto)
  async confirmEmail(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ConfirmEmailDto,
  ): Promise<ProfileDto> {
    return toProfileDto(
      await this.emailVerification.confirm(user.id, dto.code),
    );
  }
}
