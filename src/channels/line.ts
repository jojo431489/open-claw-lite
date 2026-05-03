// ============================================================
// LINE Channel Adapter
// Uses @line/bot-sdk with webhook for receiving messages
// ============================================================

import { Client, middleware, WebhookEvent, TextMessage } from '@line/bot-sdk';
import express from 'express';
import { ChannelAdapter, IncomingMessage, OutgoingMessage } from '../core/types.js';
import { logger } from '../utils/logger.js';
import { v4 as uuid } from 'uuid';

interface LineConfig {
  channelAccessToken: string;
  channelSecret: string;
  port?: number;
}

export class LineAdapter implements ChannelAdapter {
  readonly type = 'line' as const;
  private client: Client;
  private config: LineConfig;
  private messageHandler?: (msg: IncomingMessage) => Promise<void>;
  private app?: express.Express;
  private server?: ReturnType<express.Express['listen']>;

  constructor(config: LineConfig) {
    this.config = config;
    this.client = new Client({
      channelAccessToken: config.channelAccessToken,
      channelSecret: config.channelSecret,
    });
  }

  async initialize(): Promise<void> {
    this.app = express();

    // LINE webhook endpoint
    this.app.post('/webhook/line',
      middleware({ channelSecret: this.config.channelSecret }),
      async (req, res) => {
        try {
          const events: WebhookEvent[] = req.body.events;
          await Promise.all(events.map(e => this.handleEvent(e)));
          res.status(200).json({ status: 'ok' });
        } catch (err) {
          logger.error(`LINE webhook error: ${err}`);
          res.status(500).json({ error: 'Internal error' });
        }
      }
    );

    // Health check
    this.app.get('/health', (_req, res) => res.json({ status: 'ok', channel: 'line' }));

    const port = this.config.port || 3000;
    this.server = this.app.listen(port, () => {
      logger.info(`🟢 LINE webhook listening on port ${port}`);
      logger.info(`   Webhook URL: POST /webhook/line`);
    });
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void {
    this.messageHandler = handler;
  }

  async sendMessage(msg: OutgoingMessage): Promise<void> {
    const textMessage: TextMessage = {
      type: 'text',
      text: msg.text,
    };

    if (msg.replyTo) {
      await this.client.replyMessage(msg.replyTo, textMessage);
    } else {
      await this.client.pushMessage(msg.channelId, textMessage);
    }
  }

  async shutdown(): Promise<void> {
    if (this.server) {
      this.server.close();
      logger.info('LINE adapter shut down');
    }
  }

  private async handleEvent(event: WebhookEvent): Promise<void> {
    if (event.type !== 'message' || event.message.type !== 'text') return;

    const userId = event.source.userId || 'unknown';
    const channelId = event.source.type === 'group'
      ? (event.source as any).groupId
      : event.source.type === 'room'
        ? (event.source as any).roomId
        : userId;

    let userName = 'LINE User';
    try {
      const profile = await this.client.getProfile(userId);
      userName = profile.displayName;
    } catch { /* ignore */ }

    const incoming: IncomingMessage = {
      id: uuid(),
      channelType: 'line',
      channelId,
      userId: `line:${userId}`,
      userName,
      text: event.message.text,
      timestamp: new Date(event.timestamp),
      replyTo: event.replyToken,
      raw: event,
    };

    if (this.messageHandler) {
      await this.messageHandler(incoming);
    }
  }

  /** Get Express app for shared server usage */
  getExpressApp(): express.Express | undefined {
    return this.app;
  }
}
