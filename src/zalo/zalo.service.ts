import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { ZaloSendMessageResponse } from './interfaces/zalo-webhook.interface';

@Injectable()
export class ZaloService {
  private readonly logger = new Logger(ZaloService.name);
  private readonly apiBaseUrl: string;
  private readonly botToken: string;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {
    this.apiBaseUrl = this.configService.get<string>('zalo.apiBaseUrl')!;
    this.botToken = this.configService.get<string>('zalo.botToken')!;
  }

  /**
   * Sends a text message to a chat via the Zalo Bot API. Never throws:
   * a failed outbound send is logged and swallowed so a Zalo API outage
   * never turns into an unhandled exception for the webhook request that
   * triggered it (the webhook must always ack quickly regardless).
   */
  async sendTextMessage(chatId: string, text: string): Promise<void> {
    const url = `${this.apiBaseUrl}${this.botToken}/sendMessage`;
    try {
      await firstValueFrom(
        this.httpService.post<ZaloSendMessageResponse>(
          url,
          { chat_id: chatId, text },
          { timeout: 8000 },
        ),
      );
    } catch (error) {
      this.logger.error(
        `Failed to send Zalo message to chat ${chatId}: ${(error as Error).message}`,
      );
    }
  }
}
