import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { of, throwError } from 'rxjs';
import { ZaloService } from './zalo.service';

describe('ZaloService', () => {
  let service: ZaloService;
  let httpPost: jest.Mock;

  const config: Record<string, unknown> = {
    'zalo.apiBaseUrl': 'https://bot-api.zaloplatforms.com/bot',
    'zalo.botToken': 'test-token',
  };

  beforeEach(async () => {
    httpPost = jest.fn();

    const moduleRef = await Test.createTestingModule({
      providers: [
        ZaloService,
        { provide: HttpService, useValue: { post: httpPost } },
        { provide: ConfigService, useValue: { get: (key: string) => config[key] } },
      ],
    }).compile();

    service = moduleRef.get(ZaloService);
  });

  it('posts to the sendMessage endpoint and resolves true on success', async () => {
    httpPost.mockReturnValue(of({ data: { ok: true } }));

    await expect(service.sendTextMessage('chat-1', 'hello')).resolves.toBe(true);
    expect(httpPost).toHaveBeenCalledWith(
      'https://bot-api.zaloplatforms.com/bottest-token/sendMessage',
      { chat_id: 'chat-1', text: 'hello' },
      { timeout: 8000 },
    );
  });

  it('resolves false (without throwing) when Zalo answers ok: false', async () => {
    httpPost.mockReturnValue(of({ data: { ok: false, description: 'chat not found' } }));

    await expect(service.sendTextMessage('chat-1', 'hello')).resolves.toBe(false);
  });

  it('resolves false (without throwing) when the HTTP call fails', async () => {
    httpPost.mockReturnValue(throwError(() => new Error('timeout of 8000ms exceeded')));

    await expect(service.sendTextMessage('chat-1', 'hello')).resolves.toBe(false);
  });
});
