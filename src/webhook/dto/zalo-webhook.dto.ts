import { Type } from 'class-transformer';
import { IsNotEmpty, IsObject, IsOptional, IsString, ValidateNested } from 'class-validator';

export class ZaloWebhookChatDto {
  @IsString()
  @IsNotEmpty()
  id!: string;

  @IsOptional()
  @IsString()
  type?: string;
}

export class ZaloWebhookFromDto {
  @IsString()
  @IsNotEmpty()
  id!: string;

  @IsOptional()
  @IsString()
  display_name?: string;
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
 * Validated shape of an inbound Zalo Bot webhook call. `message` is optional
 * because some webhook events (e.g. bot added to a group) carry no message
 * — those are acknowledged and ignored by WebhookController.
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
