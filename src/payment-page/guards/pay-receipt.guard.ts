import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { PaymentPageService } from '../../transactions/services/payment-page.service';
import { clientKeyOf } from '../utils/client-key-of';

const UPLOADS_IN_PROGRESS_PER_CLIENT = 2;
const UPLOADS_IN_PROGRESS_TOTAL = 8;

const tooManyUploads = (message: string): HttpException =>
  new HttpException(
    {
      statusCode: HttpStatus.TOO_MANY_REQUESTS,
      code: 'TOO_MANY_UPLOADS',
      message,
    },
    HttpStatus.TOO_MANY_REQUESTS,
  );

@Injectable()
export class PayReceiptGuard implements CanActivate {
  private readonly inProgress = new Map<string, number>();
  private total = 0;

  constructor(private readonly pages: PaymentPageService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const client = clientKeyOf(request.ip);

    if ((this.inProgress.get(client) ?? 0) >= UPLOADS_IN_PROGRESS_PER_CLIENT) {
      throw tooManyUploads(
        'Another upload from this address is still in progress',
      );
    }

    if (this.total >= UPLOADS_IN_PROGRESS_TOTAL) {
      throw tooManyUploads('Too many uploads in progress; try again shortly');
    }

    this.total += 1;
    this.inProgress.set(client, (this.inProgress.get(client) ?? 0) + 1);
    http.getResponse<Response>().once('close', () => this.release(client));

    await this.pages.assertAcceptsReceipt(String(request.params.token));

    return true;
  }

  private release(client: string): void {
    this.total -= 1;

    const left = (this.inProgress.get(client) ?? 1) - 1;

    if (left > 0) this.inProgress.set(client, left);
    else this.inProgress.delete(client);
  }
}
