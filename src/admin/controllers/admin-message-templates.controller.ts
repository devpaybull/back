import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelopeResponse } from '../../common/decorators/api-envelope-response.decorator';
import { ApiPagedResponse } from '../../common/decorators/api-paged-response.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { WriteAccess } from '../../common/decorators/write-access.decorator';
import { Role } from '../../common/enums/role.enum';
import { RolesGuard } from '../../common/guards/roles.guard';
import { WriteAccessGuard } from '../../common/guards/write-access.guard';
import { Page } from '../../common/types/page';
import { formatFiat } from '../../common/utils/format-fiat';
import { MessageTemplatesService } from '../../message-templates/message-templates.service';
import { CreateMessageTemplateDto } from '../dto/create-message-template.dto';
import { ListMessageTemplatesQueryDto } from '../dto/list-message-templates-query.dto';
import { MessageTemplateTestResultDto } from '../dto/message-template-test-result.dto';
import {
  MessageTemplateDto,
  toMessageTemplateDto,
} from '../dto/message-template.dto';
import { TestMessageTemplateDto } from '../dto/test-message-template.dto';
import { UpdateMessageTemplateDto } from '../dto/update-message-template.dto';

@ApiTags('Admin · Message templates')
@ApiBearerAuth()
@UseGuards(RolesGuard, WriteAccessGuard)
@Roles(Role.Admin, Role.Superadmin)
@Controller('admin/message-templates')
export class AdminMessageTemplatesController {
  constructor(private readonly templates: MessageTemplatesService) {}

  @Post()
  @WriteAccess()
  @ApiOperation({
    summary: 'Adds a bank message template',
    description:
      'The pattern must compile with the flags i and u and carry a named group amount; otherwise a 400. An unknown bank is a 400.',
  })
  @ApiEnvelopeResponse(MessageTemplateDto, { status: HttpStatus.CREATED })
  async create(
    @Body() dto: CreateMessageTemplateDto,
  ): Promise<MessageTemplateDto> {
    return toMessageTemplateDto(await this.templates.create(dto));
  }

  @Post('test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Runs a pattern on a sample text, stores nothing',
    description:
      'The same reading the device messages get: a pattern that runs longer than 50 ms on the text is a 400.',
  })
  @ApiEnvelopeResponse(MessageTemplateTestResultDto)
  test(@Body() dto: TestMessageTemplateDto): MessageTemplateTestResultDto {
    const result = this.templates.test(dto.pattern, dto.text);

    return {
      matched: result.matched,
      amount: result.amount ? formatFiat(result.amount) : null,
    };
  }

  @Get()
  @ApiOperation({
    summary: 'Lists bank message templates',
    description: 'search matches the sender',
  })
  @ApiPagedResponse(MessageTemplateDto)
  async list(
    @Query() query: ListMessageTemplatesQueryDto,
  ): Promise<Page<MessageTemplateDto>> {
    return (await this.templates.list(query)).map(toMessageTemplateDto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Reads one bank message template' })
  @ApiEnvelopeResponse(MessageTemplateDto)
  async findOne(
    @Param('id', ParseIntPipe) id: number,
  ): Promise<MessageTemplateDto> {
    const template = await this.templates.findById(id);

    if (!template) throw new NotFoundException('Message template not found');

    return toMessageTemplateDto(template);
  }

  @Patch(':id')
  @WriteAccess()
  @ApiOperation({ summary: 'Updates a bank message template' })
  @ApiEnvelopeResponse(MessageTemplateDto)
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateMessageTemplateDto,
  ): Promise<MessageTemplateDto> {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException('No changes were given');
    }

    return toMessageTemplateDto(await this.templates.update(id, dto));
  }

  @Delete(':id')
  @WriteAccess()
  @ApiOperation({
    summary: 'Deletes a bank message template',
    description:
      'A hard delete; messages it read keep their type and amount and lose the link.',
  })
  @ApiEnvelopeResponse()
  async remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.templates.delete(id);
  }
}
