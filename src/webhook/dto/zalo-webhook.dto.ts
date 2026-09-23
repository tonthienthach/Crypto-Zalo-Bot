import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/** Upper bound on a chat id we persist — real Zalo ids are 20 hex chars. */
export const MAX_CHAT_ID_LENGTH = 64;

export class ZaloWebhookChatDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_CHAT_ID_LENGTH)
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

/**
 * Validated shape of an inbound Zalo Bot webhook call. CONFIRMED LIVE
 * against a real production webhook call (2026-09-04) — the update is a
 * FLAT object: `{ event_name, message }`, not wrapped in `{ ok, result }`.
 * `message` is optional because some events carry no message (e.g. a "bot
 * added to group" event) — those are acknowledged and ignored by
 * WebhookController.
 */
export class ZaloWebhookDto {
  @IsOptional()
  @IsString()
  event_name?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ZaloWebhookMessageDto)
  message?: ZaloWebhookMessageDto;
}
