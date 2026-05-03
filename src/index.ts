// ============================================================
// OpenClaw Lite - Main Gateway
// Connects channels → agent → LLM → tools → response
// ============================================================

import dotenv from 'dotenv';
dotenv.config();

import { loadConfig } from './utils/config.js';
import { logger } from './utils/logger.js';
import { eventBus } from './core/events.js';
import { createLLMClient } from './core/llm.js';
import { Agent } from './core/agent.js';
import { SQLiteMemoryStore } from './memory/store.js';
import { SkillManager } from './skills/manager.js';
import { ChannelAdapter, IncomingMessage, OutgoingMessage } from './core/types.js';

// Channel adapters
import { LineAdapter } from './channels/line.js';
import { TelegramAdapter } from './channels/telegram.js';
import { DiscordAdapter } from './channels/discord.js';
import { WebChatAdapter } from './channels/webchat.js';

async function main() {
  console.log(`
  🦞 ═══════════════════════════════════════
     OpenClaw Lite v1.0.0
     Local AI Assistant Gateway
  ═══════════════════════════════════════════
  `);

  // 1. Load configuration
  const config = loadConfig();
  logger.info(`Bot name: ${config.botName}`);

  // 2. Initialize memory store
  const memory = new SQLiteMemoryStore(config.memory.dbPath);
  logger.info('Memory store ready');

  // 3. Initialize LLM client
  const llm = createLLMClient(config.llm);

  // 4. Initialize skill manager & load skills
  const skills = new SkillManager(config);
  await skills.loadBuiltinSkills();

  // 5. Create agent
  const agent = new Agent(config, llm, memory, skills);
  logger.info('Agent initialized');

  // 6. Set up channels
  const channels: ChannelAdapter[] = [];

  // LINE
  if (config.channels.line) {
    const line = new LineAdapter(config.channels.line);
    channels.push(line);
    logger.info('LINE channel configured');
  }

  // Telegram
  if (config.channels.telegram) {
    const telegram = new TelegramAdapter(config.channels.telegram);
    channels.push(telegram);
    logger.info('Telegram channel configured');
  }

  // Discord
  if (config.channels.discord) {
    const discord = new DiscordAdapter(config.channels.discord);
    channels.push(discord);
    logger.info('Discord channel configured');
  }

  // WebChat (always enabled as fallback)
  const webchat = new WebChatAdapter({ port: config.server.port });
  channels.push(webchat);

  // 7. Wire up message handling for all channels
  const messageRouter = async (msg: IncomingMessage) => {
    await eventBus.emit('message:received', msg);

    // Process through agent
    const responseText = await agent.processMessage(msg);

    // Send response back through the same channel
    const outgoing: OutgoingMessage = {
      text: responseText,
      channelType: msg.channelType,
      channelId: msg.channelId,
      replyTo: msg.replyTo,
    };

    const adapter = channels.find(c => c.type === msg.channelType);
    if (adapter) {
      await adapter.sendMessage(outgoing);
      await eventBus.emit('message:sent', outgoing);
    }
  };

  for (const channel of channels) {
    channel.onMessage(messageRouter);
  }

  // 8. Initialize all channels
  for (const channel of channels) {
    try {
      await channel.initialize();
    } catch (err) {
      logger.error(`Failed to initialize ${channel.type}: ${err}`);
    }
  }

  // 9. Event logging
  eventBus.on('tool:called', (e) => {
    const data = e.data as any;
    logger.debug(`🔧 Tool called: ${data.name}`);
  });

  eventBus.on('error', (e) => {
    logger.error(`Event error: ${e.data}`);
  });

  // 10. Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');
    for (const channel of channels) {
      await channel.shutdown().catch(err => logger.error(`Shutdown error: ${err}`));
    }
    memory.close();
    logger.info('Goodbye! 🦞');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  logger.info('');
  logger.info('🦞 OpenClaw Lite is running!');
  logger.info(`   Channels: ${channels.map(c => c.type).join(', ')}`);
  logger.info(`   WebChat: http://localhost:${config.server.port}`);
  logger.info(`   LLM: ${config.llm.provider} / ${config.llm.model}`);
  logger.info('');
}

main().catch((err) => {
  logger.error(`Fatal error: ${err}`);
  process.exit(1);
});
