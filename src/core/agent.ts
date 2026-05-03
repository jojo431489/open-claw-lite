// ============================================================
// Agent Core - The brain of the system
// Orchestrates: LLM calls, tool execution, memory, context
// Implements ReAct-style reasoning loop
// ============================================================

import {
  AppConfig, IncomingMessage, OutgoingMessage,
  ConversationMessage, ToolDefinition, ToolContext,
  LLMClient, LLMResponse,
} from '../core/types.js';
import { eventBus } from '../core/events.js';
import { SQLiteMemoryStore, MEMORY_EXTRACTION_PROMPT } from '../memory/store.js';
import { SkillManager } from '../skills/manager.js';
import { logger } from '../utils/logger.js';

const MAX_TOOL_ROUNDS = 10;

export class Agent {
  constructor(
    private config: AppConfig,
    private llm: LLMClient,
    private memory: SQLiteMemoryStore,
    private skills: SkillManager,
  ) {}

  /**
   * Process an incoming message and return a response.
   * This is the main entry point for the agent.
   */
  async processMessage(msg: IncomingMessage): Promise<string> {
    const sessionKey = `${msg.channelType}:${msg.channelId}`;
    logger.info(`[${sessionKey}] ${msg.userName}: ${msg.text.slice(0, 100)}`);

    try {
      // 1. Check for built-in commands
      const commandResult = await this.handleCommand(msg);
      if (commandResult) return commandResult;

      // 2. Build context
      const messages = await this.buildContext(msg);
      const tools = this.skills.getAllTools();

      // 3. Run agent loop (ReAct: Reason → Act → Observe)
      const response = await this.agentLoop(messages, tools, msg);

      // 4. Save conversation
      this.memory.saveConversation(msg.userId, msg.channelType, msg.channelId, 'user', msg.text);
      this.memory.saveConversation(msg.userId, msg.channelType, msg.channelId, 'assistant', response);

      // 5. Auto-extract memories (async, don't block response)
      if (this.config.memory.autoExtract) {
        this.extractMemories(msg.userId, msg.text, response).catch(err =>
          logger.error(`Memory extraction failed: ${err}`)
        );
      }

      return response;
    } catch (err) {
      logger.error(`Agent error: ${err}`);
      return `❌ 抱歉，處理訊息時發生錯誤：${err instanceof Error ? err.message : String(err)}`;
    }
  }

  /**
   * ReAct agent loop - allows multiple rounds of tool calls
   */
  private async agentLoop(
    messages: ConversationMessage[],
    tools: ToolDefinition[],
    originalMsg: IncomingMessage,
  ): Promise<string> {
    let currentMessages = [...messages];
    let rounds = 0;

    while (rounds < MAX_TOOL_ROUNDS) {
      rounds++;
      const response = await this.llm.chat(currentMessages, tools);

      if (response.usage) {
        logger.debug(`LLM usage: ${response.usage.inputTokens}in / ${response.usage.outputTokens}out`);
      }

      // No tool calls → return final response
      if (!response.toolCalls || response.toolCalls.length === 0) {
        return response.content || '(No response)';
      }

      // Add assistant message with tool calls
      currentMessages.push({
        role: 'assistant',
        content: response.content || '',
        toolCalls: response.toolCalls.map(tc => ({
          id: tc.id,
          name: tc.name,
          arguments: JSON.stringify(tc.arguments),
        })),
      });

      // Execute all tool calls
      for (const toolCall of response.toolCalls) {
        const tool = this.skills.getTool(toolCall.name);
        if (!tool) {
          currentMessages.push({
            role: 'tool',
            content: JSON.stringify({ error: `Unknown tool: ${toolCall.name}` }),
            toolCallId: toolCall.id,
          });
          continue;
        }

        const context: ToolContext = {
          userId: originalMsg.userId,
          channelType: originalMsg.channelType,
          channelId: originalMsg.channelId,
          sessionId: `${originalMsg.channelType}:${originalMsg.channelId}`,
          memory: this.memory,
          config: this.config,
        };

        try {
          await eventBus.emit('tool:called', { name: toolCall.name, args: toolCall.arguments });
          const result = await tool.execute(toolCall.arguments, context);
          await eventBus.emit('tool:result', { name: toolCall.name, result });

          currentMessages.push({
            role: 'tool',
            content: JSON.stringify(result),
            toolCallId: toolCall.id,
          });
          logger.info(`Tool ${toolCall.name}: ${result.success ? '✅' : '❌'}`);
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          currentMessages.push({
            role: 'tool',
            content: JSON.stringify({ success: false, error: errorMsg }),
            toolCallId: toolCall.id,
          });
          logger.error(`Tool ${toolCall.name} error: ${errorMsg}`);
        }
      }
    }

    return '⚠️ 工具呼叫次數已達上限，以下是目前的結果。';
  }

  /**
   * Build conversation context including system prompt, memories, and history
   */
  private async buildContext(msg: IncomingMessage): Promise<ConversationMessage[]> {
    const messages: ConversationMessage[] = [];

    // System prompt
    const systemPrompt = this.buildSystemPrompt(msg);
    messages.push({ role: 'system', content: systemPrompt });

    // Conversation history
    const history = this.memory.getConversationHistory(
      msg.userId, msg.channelType, msg.channelId, 20
    );
    for (const h of history) {
      messages.push({ role: h.role as any, content: h.content });
    }

    // Current message
    messages.push({ role: 'user', content: msg.text });

    return messages;
  }

  /**
   * Build dynamic system prompt with memories and skill info
   */
  private buildSystemPrompt(msg: IncomingMessage): string {
    const parts: string[] = [];

    // Base identity
    parts.push(`You are ${this.config.botName}, a personal AI assistant running locally.
You are helpful, proactive, and capable of executing tasks through tools.
Current time: ${new Date().toLocaleString(this.config.language, { timeZone: this.config.timezone })}
Language: Respond in the user's language. Default: ${this.config.language}
Channel: ${msg.channelType} (user: ${msg.userName})`);

    // Memories
    const memories = this.memory.getConversationHistory(msg.userId, '', '', 0); // trigger init
    const allMems = this.getAllUserMemoriesSync(msg.userId);
    if (allMems.length > 0) {
      parts.push('\n--- User Memories ---');
      for (const m of allMems) {
        parts.push(`[${m.category}] ${m.key}: ${m.value}`);
      }
      parts.push('--- End Memories ---');
    }

    // Skills
    const skillAdditions = this.skills.getSystemPromptAdditions();
    if (skillAdditions) {
      parts.push('\n--- Available Skills ---');
      parts.push(skillAdditions);
      parts.push('--- End Skills ---');
    }

    // Available tools summary
    const tools = this.skills.getAllTools();
    if (tools.length > 0) {
      parts.push(`\nYou have ${tools.length} tools available. Use them proactively when they can help.`);
    }

    return parts.join('\n');
  }

  private getAllUserMemoriesSync(userId: string): Array<{ key: string; value: string; category: string }> {
    // Sync wrapper since we're in prompt building
    try {
      const db = (this.memory as any).db;
      const stmt = db.prepare(`
        SELECT key, value, category FROM memories
        WHERE user_id = ? ORDER BY importance DESC LIMIT 20
      `);
      return stmt.all(userId) as any[];
    } catch {
      return [];
    }
  }

  /**
   * Handle built-in slash commands
   */
  private async handleCommand(msg: IncomingMessage): Promise<string | null> {
    const text = msg.text.trim();

    if (text === '/help') {
      return `🦞 ${this.config.botName} - 指令列表

/help - 顯示此說明
/skills - 列出已載入的技能
/memory - 查看我記住的關於你的資訊
/forget <key> - 忘記特定記憶
/clear - 清除對話歷史
/status - 系統狀態
/config - 查看目前設定`;
    }

    if (text === '/skills') {
      return this.skills.getSkillsSummary();
    }

    if (text === '/memory') {
      const memories = await this.memory.getAllMemories(msg.userId);
      if (memories.length === 0) return '🧠 目前沒有關於你的記憶。';
      const lines = ['🧠 我記住的關於你的資訊：'];
      for (const m of memories.slice(0, 20)) {
        lines.push(`  [${m.category}] ${m.key}: ${m.value}`);
      }
      if (memories.length > 20) lines.push(`  ... 還有 ${memories.length - 20} 條記憶`);
      return lines.join('\n');
    }

    if (text.startsWith('/forget ')) {
      const key = text.slice(8).trim();
      await this.memory.forget(msg.userId, key);
      return `🗑️ 已忘記: ${key}`;
    }

    if (text === '/clear') {
      // Clear conversation history for this channel
      try {
        const db = (this.memory as any).db;
        db.prepare(`DELETE FROM conversations WHERE user_id = ? AND channel_type = ? AND channel_id = ?`)
          .run(msg.userId, msg.channelType, msg.channelId);
        return '🧹 對話歷史已清除！';
      } catch {
        return '❌ 清除失敗';
      }
    }

    if (text === '/status') {
      const skills = this.skills.getAllSkills();
      const tools = this.skills.getAllTools();
      return `📊 系統狀態
🤖 名稱: ${this.config.botName}
🧠 LLM: ${this.config.llm.provider} / ${this.config.llm.model}
📦 技能: ${skills.length} 個
🔧 工具: ${tools.length} 個
💾 記憶系統: ${this.config.memory.enabled ? '啟用' : '停用'}
🌐 頻道: ${Object.keys(this.config.channels).join(', ') || 'none'}`;
    }

    return null; // Not a command
  }

  /**
   * Extract and store memories from a conversation turn
   */
  private async extractMemories(userId: string, userMsg: string, assistantMsg: string): Promise<void> {
    try {
      const response = await this.llm.chat([
        { role: 'system', content: MEMORY_EXTRACTION_PROMPT },
        { role: 'user', content: `User said: "${userMsg}"\nAssistant replied: "${assistantMsg}"\n\nExtract memories:` },
      ]);

      const text = response.content.trim();
      if (!text || text === '[]') return;

      const memories = JSON.parse(text);
      if (!Array.isArray(memories)) return;

      for (const mem of memories) {
        if (mem.key && mem.value) {
          await this.memory.remember(
            userId,
            mem.key,
            mem.value,
            mem.category || 'fact',
            mem.importance || 0.5
          );
        }
      }
    } catch (err) {
      // Silently fail - memory extraction is best-effort
      logger.debug(`Memory extraction parse error: ${err}`);
    }
  }
}
