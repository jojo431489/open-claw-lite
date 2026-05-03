// ============================================================
// Config - Load & validate configuration
// ============================================================

import fs from 'fs';
import path from 'path';
import { AppConfig } from '../core/types.js';
import { logger } from './logger.js';

const CONFIG_PATH = process.env.CONFIG_PATH ?? './config/config.json';

const DEFAULT_CONFIG: AppConfig = {
  botName: 'ClawBot',
  language: 'zh-TW',
  timezone: 'Asia/Taipei',
  llm: {
    provider: 'anthropic',
    model: 'claude-sonnet-4-20250514',
    temperature: 0.7,
    maxTokens: 4096,
  },
  channels: {},
  memory: {
    enabled: true,
    dbPath: './data/memory.db',
    maxEntriesPerUser: 500,
    autoExtract: true,
  },
  skills: {
    enabled: true,
    directory: './skills-builtin',
    autoLoad: true,
  },
  server: {
    port: 3000,
  },
  security: {
    allowedUsers: [],
    adminUsers: [],
    requireApproval: false,
  },
};

function deepMerge(target: any, source: any): any {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(target[key] ?? {}, source[key]);
    } else if (source[key] !== undefined) {
      result[key] = source[key];
    }
  }
  return result;
}

export function loadConfig(): AppConfig {
  let fileConfig: Partial<AppConfig> = {};

  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
      fileConfig = JSON.parse(raw);
      logger.info(`Configuration loaded from ${CONFIG_PATH}`);
    } catch (err) {
      logger.warn(`Failed to parse config file: ${err}`);
    }
  } else {
    logger.info('No config file found, using defaults + environment variables');
  }

  const config = deepMerge(DEFAULT_CONFIG, fileConfig) as AppConfig;

  // Override with environment variables
  if (process.env.BOT_NAME) config.botName = process.env.BOT_NAME;
  if (process.env.LLM_PROVIDER) config.llm.provider = process.env.LLM_PROVIDER as any;
  if (process.env.LLM_MODEL) config.llm.model = process.env.LLM_MODEL;
  if (process.env.LLM_API_KEY) config.llm.apiKey = process.env.LLM_API_KEY;
  if (process.env.LLM_BASE_URL) config.llm.baseUrl = process.env.LLM_BASE_URL;

  // Channel tokens from env
  if (process.env.LINE_CHANNEL_ACCESS_TOKEN && process.env.LINE_CHANNEL_SECRET) {
    config.channels.line = {
      channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
      channelSecret: process.env.LINE_CHANNEL_SECRET,
      port: Number(process.env.LINE_PORT) || undefined,
    };
  }
  if (process.env.TELEGRAM_BOT_TOKEN) {
    config.channels.telegram = { botToken: process.env.TELEGRAM_BOT_TOKEN };
  }
  if (process.env.DISCORD_BOT_TOKEN && process.env.DISCORD_APP_ID) {
    config.channels.discord = {
      botToken: process.env.DISCORD_BOT_TOKEN,
      applicationId: process.env.DISCORD_APP_ID,
    };
  }

  if (process.env.WEBHOOK_URL) config.server.webhookUrl = process.env.WEBHOOK_URL;
  if (process.env.PORT) config.server.port = Number(process.env.PORT);

  return config;
}

export function saveConfig(config: AppConfig): void {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
  logger.info(`Configuration saved to ${CONFIG_PATH}`);
}
