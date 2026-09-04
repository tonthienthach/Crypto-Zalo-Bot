import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Request } from 'express';

/**
 * Rate-limits by Zalo chat id instead of source IP. All webhook calls come
 * from Zalo's own servers, so IP-based throttling would rate-limit every
 * user collectively; tracking by chat id enforces the limit per end user
 * instead, which is what "rate limit theo user" requires.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Request): Promise<string> {
    const body = req.body as { result?: { message?: { chat?: { id?: string } } } } | undefined;
    const chatId = body?.result?.message?.chat?.id;
    return chatId ? `chat:${chatId}` : (req.ip ?? 'unknown');
  }
}
