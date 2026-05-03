// ============================================================
// Discord Channel Adapter
// Uses discord.js v14 for bot interaction
// ============================================================

import {
  Client as DiscordClient,
  GatewayIntentBits,
  Events,
  Message,
  Partials,
} from 'discord.js';
import { ChannelAdapter, IncomingMessage, OutgoingMessage } from '../core/types.js';
import { logger } from '../utils/logger.js';
import { v4 as uuid } from 'uuid';

interface DiscordConfig {
  botToken: string;
  applicationId: string;
}

export class DiscordAdapter implements ChannelAdapter {
  readonly type = 'discord' as const;
  private client: DiscordClient;
  private config: DiscordConfig;
  private messageHandler?: (msg: IncomingMessage) => Promise<void>;
  private botUserId?: string;

  constructor(config: DiscordConfig) {
    this.config = config;
    this.client = new DiscordClient({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.MessageContent,
      ],
      partials: [Partials.Channel, Partials.Message],
    });
  }

  async initialize(): Promise<void> {
    this.client.on(Events.ClientReady, (c) => {
      this.botUserId = c.user.id;
      logger.info(`🟢 Discord bot ready: ${c.user.tag}`);
    });

    this.client.on(Events.MessageCreate, async (message: Message) => {
      // Ignore bot's own messages
      if (message.author.bot) return;
      if (!this.messageHandler) return;

      // In guilds, only respond when mentioned or in DMs
      const isDM = !message.guild;
      const isMentioned = message.mentions.has(this.botUserId || '');

      if (!isDM && !isMentioned) return;

      // Remove bot mention from text
      let text = message.content;
      if (isMentioned) {
        text = text.replace(new RegExp(`<@!?${this.botUserId}>`, 'g'), '').trim();
      }
      if (!text) text = '(empty message)';

      const incoming: IncomingMessage = {
        id: uuid(),
        channelType: 'discord',
        channelId: message.channelId,
        userId: `discord:${message.author.id}`,
        userName: message.author.displayName || message.author.username,
        text,
        timestamp: message.createdAt,
        raw: message,
      };

      await this.messageHandler(incoming);
    });

    await this.client.login(this.config.botToken);
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void {
    this.messageHandler = handler;
  }

  async sendMessage(msg: OutgoingMessage): Promise<void> {
    const channel = await this.client.channels.fetch(msg.channelId);
    if (!channel || !('send' in channel)) {
      logger.warn(`Cannot send to Discord channel ${msg.channelId}`);
      return;
    }

    const MAX_LEN = 1900; // Discord limit is 2000
    if (msg.text.length <= MAX_LEN) {
      await (channel as any).send(msg.text);
    } else {
      const chunks = this.splitText(msg.text, MAX_LEN);
      for (const chunk of chunks) {
        await (channel as any).send(chunk);
      }
    }
  }

  async shutdown(): Promise<void> {
    this.client.destroy();
    logger.info('Discord adapter shut down');
  }

  private splitText(text: string, maxLen: number): string[] {
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= maxLen) { chunks.push(remaining); break; }
      let splitIdx = remaining.lastIndexOf('\n', maxLen);
      if (splitIdx < maxLen / 2) splitIdx = maxLen;
      chunks.push(remaining.slice(0, splitIdx));
      remaining = remaining.slice(splitIdx).trimStart();
    }
    return chunks;
  }
}
