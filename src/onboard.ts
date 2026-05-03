// ============================================================
// Onboarding Wizard - Interactive setup
// ============================================================

import inquirer from 'inquirer';
import fs from 'fs';
import path from 'path';
import { AppConfig } from './core/types.js';
import { saveConfig } from './utils/config.js';

async function onboard() {
  console.log(`
  🦞 ═══════════════════════════════════════
     OpenClaw Lite - 設定精靈
     Let's set up your AI assistant!
  ═══════════════════════════════════════════
  `);

  // Bot name
  const { botName } = await inquirer.prompt([{
    type: 'input',
    name: 'botName',
    message: '🤖 你的 AI 助理叫什麼名字？',
    default: 'ClawBot',
  }]);

  // LLM Provider
  const { provider } = await inquirer.prompt([{
    type: 'list',
    name: 'provider',
    message: '🧠 選擇 AI 模型供應商:',
    choices: [
      { name: 'Anthropic Claude (推薦)', value: 'anthropic' },
      { name: 'OpenAI GPT', value: 'openai' },
      { name: 'Ollama (本地模型)', value: 'ollama' },
      { name: 'Custom (自訂 OpenAI-compatible API)', value: 'custom' },
    ],
  }]);

  let llmConfig: any = { provider };

  if (provider === 'anthropic') {
    const { apiKey, model } = await inquirer.prompt([
      { type: 'password', name: 'apiKey', message: '🔑 Anthropic API Key:', mask: '*' },
      {
        type: 'list', name: 'model', message: '模型:',
        choices: ['claude-sonnet-4-20250514', 'claude-opus-4-6', 'claude-haiku-4-5-20251001'],
        default: 'claude-sonnet-4-20250514',
      },
    ]);
    llmConfig = { ...llmConfig, apiKey, model };
  } else if (provider === 'openai') {
    const { apiKey, model } = await inquirer.prompt([
      { type: 'password', name: 'apiKey', message: '🔑 OpenAI API Key:', mask: '*' },
      { type: 'input', name: 'model', message: '模型:', default: 'gpt-4o' },
    ]);
    llmConfig = { ...llmConfig, apiKey, model };
  } else if (provider === 'ollama') {
    const { model, baseUrl } = await inquirer.prompt([
      { type: 'input', name: 'model', message: '模型名稱:', default: 'llama3.2' },
      { type: 'input', name: 'baseUrl', message: 'Ollama URL:', default: 'http://localhost:11434/v1' },
    ]);
    llmConfig = { ...llmConfig, model, baseUrl };
  } else {
    const { apiKey, model, baseUrl } = await inquirer.prompt([
      { type: 'input', name: 'baseUrl', message: 'API Base URL:' },
      { type: 'password', name: 'apiKey', message: 'API Key:', mask: '*' },
      { type: 'input', name: 'model', message: '模型名稱:' },
    ]);
    llmConfig = { ...llmConfig, apiKey, model, baseUrl };
  }

  // Channels
  const { channelChoices } = await inquirer.prompt([{
    type: 'checkbox',
    name: 'channelChoices',
    message: '📱 啟用哪些通訊平台？ (WebChat 預設啟用)',
    choices: [
      { name: 'LINE', value: 'line' },
      { name: 'Telegram', value: 'telegram' },
      { name: 'Discord', value: 'discord' },
    ],
  }]);

  const channels: any = {};

  if (channelChoices.includes('line')) {
    const lineConfig = await inquirer.prompt([
      { type: 'input', name: 'channelAccessToken', message: 'LINE Channel Access Token:' },
      { type: 'input', name: 'channelSecret', message: 'LINE Channel Secret:' },
    ]);
    channels.line = lineConfig;
  }

  if (channelChoices.includes('telegram')) {
    const { botToken } = await inquirer.prompt([
      { type: 'input', name: 'botToken', message: 'Telegram Bot Token (from @BotFather):' },
    ]);
    channels.telegram = { botToken };
  }

  if (channelChoices.includes('discord')) {
    const discordConfig = await inquirer.prompt([
      { type: 'input', name: 'botToken', message: 'Discord Bot Token:' },
      { type: 'input', name: 'applicationId', message: 'Discord Application ID:' },
    ]);
    channels.discord = discordConfig;
  }

  // Server port
  const { port } = await inquirer.prompt([{
    type: 'number',
    name: 'port',
    message: '🌐 Server port:',
    default: 3000,
  }]);

  // Build config
  const config: AppConfig = {
    botName,
    language: 'zh-TW',
    timezone: 'Asia/Taipei',
    llm: { ...llmConfig, temperature: 0.7, maxTokens: 4096 },
    channels,
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
    server: { port },
    security: {
      allowedUsers: [],
      adminUsers: [],
      requireApproval: false,
    },
  };

  saveConfig(config);

  // Also create .env file
  const envLines = [
    `BOT_NAME=${botName}`,
    `LLM_PROVIDER=${llmConfig.provider}`,
    `LLM_MODEL=${llmConfig.model}`,
  ];
  if (llmConfig.apiKey) envLines.push(`LLM_API_KEY=${llmConfig.apiKey}`);
  if (llmConfig.baseUrl) envLines.push(`LLM_BASE_URL=${llmConfig.baseUrl}`);
  if (channels.line) {
    envLines.push(`LINE_CHANNEL_ACCESS_TOKEN=${channels.line.channelAccessToken}`);
    envLines.push(`LINE_CHANNEL_SECRET=${channels.line.channelSecret}`);
  }
  if (channels.telegram) envLines.push(`TELEGRAM_BOT_TOKEN=${channels.telegram.botToken}`);
  if (channels.discord) {
    envLines.push(`DISCORD_BOT_TOKEN=${channels.discord.botToken}`);
    envLines.push(`DISCORD_APP_ID=${channels.discord.applicationId}`);
  }
  envLines.push(`PORT=${port}`);

  fs.writeFileSync('.env', envLines.join('\n'));

  console.log(`
  ✅ 設定完成！

  📁 設定檔: config/config.json
  📁 環境變數: .env

  🚀 啟動方式:
     npm run dev      # 開發模式 (推薦)
     npm run build    # 編譯
     npm start        # 正式啟動

  🌐 WebChat: http://localhost:${port}

  🦞 Happy hacking!
  `);
}

onboard().catch(console.error);
