// ============================================================
// Telegram Channel Adapter
// Uses Telegraf (grammY alternative) for bot interaction
// ============================================================

import { Telegraf } from 'telegraf';
import { ChannelAdapter, IncomingMessage, OutgoingMessage } from '../core/types.js';
import { logger } from '../utils/logger.js';
import { v4 as uuid } from 'uuid';

interface TelegramConfig {
  botToken: string;
}

export class TelegramAdapter implements ChannelAdapter {
  readonly type = 'telegram' as const;
  private bot: Telegraf;
  private messageHandler?: (msg: IncomingMessage) => Promise<void>;

  constructor(config: TelegramConfig) {
    this.bot = new Telegraf(config.botToken);
  }

  async initialize(): Promise<void> {
    // Handle text messages
    this.bot.on('text', async (ctx) => {
      if (!this.messageHandler) return;

      const msg = ctx.message;
      const incoming: IncomingMessage = {
        id: uuid(),
        channelType: 'telegram',
        channelId: String(msg.chat.id),
        userId: `telegram:${msg.from.id}`,
        userName: msg.from.first_name + (msg.from.last_name ? ` ${msg.from.last_name}` : ''),
        text: msg.text,
        timestamp: new Date(msg.date * 1000),
        raw: msg,
      };

      await this.messageHandler(incoming);
    });

    // Handle photos with captions
    this.bot.on('photo', async (ctx) => {
      if (!this.messageHandler) return;

      const msg = ctx.message;
      const incoming: IncomingMessage = {
        id: uuid(),
        channelType: 'telegram',
        channelId: String(msg.chat.id),
        userId: `telegram:${msg.from.id}`,
        userName: msg.from.first_name + (msg.from.last_name ? ` ${msg.from.last_name}` : ''),
        text: msg.caption || '[Photo received]',
        timestamp: new Date(msg.date * 1000),
        attachments: [{
          type: 'image',
          mimeType: 'image/jpeg',
        }],
        raw: msg,
      };

      await this.messageHandler(incoming);
    });

    // Start polling. Telegraf's launch() returns a promise that only resolves
    // when the bot stops, so don't await it — it would block subsequent channel
    // initialisation. Capture any startup errors instead.
    this.bot.launch().catch((err) => logger.error(`Telegram polling error: ${err}`));

    const botInfo = await this.bot.telegram.getMe();
    logger.info(`🟢 Telegram bot started: @${botInfo.username}`);

    // Graceful shutdown
    process.once('SIGINT', () => this.bot.stop('SIGINT'));
    process.once('SIGTERM', () => this.bot.stop('SIGTERM'));
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void {
    this.messageHandler = handler;
  }

  async sendMessage(msg: OutgoingMessage): Promise<void> {
    const chatId = Number(msg.channelId);

    // Split long messages (Telegram has 4096 char limit)
    const MAX_LEN = 4000;
    if (msg.text.length <= MAX_LEN) {
      await this.bot.telegram.sendMessage(chatId, msg.text, {
        parse_mode: 'Markdown',
        ...(msg.replyTo ? { reply_to_message_id: Number(msg.replyTo) } : {}),
      }).catch(async () => {
        // Fallback without markdown if parsing fails
        await this.bot.telegram.sendMessage(chatId, msg.text, {
          ...(msg.replyTo ? { reply_to_message_id: Number(msg.replyTo) } : {}),
        });
      });
    } else {
      // Split into chunks
      const chunks = this.splitText(msg.text, MAX_LEN);
      for (const chunk of chunks) {
        await this.bot.telegram.sendMessage(chatId, chunk).catch(() =>
          this.bot.telegram.sendMessage(chatId, chunk)
        );
      }
    }
  }

  async shutdown(): Promise<void> {
    this.bot.stop();
    logger.info('Telegram adapter shut down');
  }

  private splitText(text: string, maxLen: number): string[] {
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= maxLen) {
        chunks.push(remaining);
        break;
      }
      // Try to split at newline
      let splitIdx = remaining.lastIndexOf('\n', maxLen);
      if (splitIdx < maxLen / 2) splitIdx = maxLen;
      chunks.push(remaining.slice(0, splitIdx));
      remaining = remaining.slice(splitIdx).trimStart();
    }
    return chunks;
  }
}
