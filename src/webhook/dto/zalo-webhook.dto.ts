import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class ZaloWebhookChatDto {
  @IsString()
  @IsNotEmpty()
  id!: string;

  @IsOptional()
  @IsString()
  chat_type?: string;
}

export class ZaloWebhookFromDto {
  @IsString()
  @IsNotEmpty()
  id!: string;

  @IsOptional()
  @IsString()
  display_name?: string;

  @IsOptional()
  @IsBoolean()
  is_bot?: boolean;
}

export class ZaloWebhookMessageDto {
  @IsOptional()
  @IsString()
  message_id?: string;

  @IsOptional()
  @IsString()
  text?: string;

  @ValidateNested()
  @Type(() => ZaloWebhookChatDto)
  @IsObject()
  chat!: ZaloWebhookChatDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ZaloWebhookFromDto)
  from?: ZaloWebhookFromDto;
}

export class ZaloWebhookResultDto {
  @IsOptional()
  @IsString()
  event_name?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ZaloWebhookMessageDto)
  message?: ZaloWebhookMessageDto;
}

/**
 * Validated shape of an inbound Zalo Bot webhook call — confirmed against
 * https://bot.zaloplatforms.com/docs/webhook/: the update is wrapped in
 * `{ ok, result: { event_name, message } }`. `result`/`message` are optional
 * because some events carry no message (or an unsupported-content event) —
 * those are acknowledged and ignored by WebhookController.
 */
export class ZaloWebhookDto {
  @IsOptional()
  @IsBoolean()
  ok?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => ZaloWebhookResultDto)
  result?: ZaloWebhookResultDto;
}
