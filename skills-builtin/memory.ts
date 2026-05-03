// ============================================================
// Built-in Skill: Memory Management
// Provides: remember, recall, forget, list memories
// ============================================================

import { SkillDefinition, ToolDefinition } from '../core/types.js';

const remember: ToolDefinition = {
  name: 'remember',
  description: 'Store a piece of information about the user for future conversations. Use this to remember preferences, facts, and important context.',
  parameters: {
    type: 'object',
    properties: {
      key: { type: 'string', description: 'Short unique key (e.g., "preferred_language", "job_title")' },
      value: { type: 'string', description: 'What to remember' },
      category: {
        type: 'string',
        enum: ['preference', 'fact', 'context', 'skill'],
        description: 'Category of memory (default: fact)',
      },
      importance: {
        type: 'number',
        description: 'Importance 0-1 (0.9=critical, 0.5=normal, 0.3=minor). Default: 0.5',
      },
    },
    required: ['key', 'value'],
  },
  async execute(args, context) {
    const { key, value, category, importance } = args as any;
    await context.memory.remember(
      context.userId,
      key,
      value,
      category || 'fact',
      importance || 0.5
    );
    return { success: true, output: `✅ 已記住: ${key} = ${value}` };
  },
};

const recall: ToolDefinition = {
  name: 'recall',
  description: 'Search for stored memories about the user. Use when you need to recall something you previously stored.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query to find relevant memories' },
      limit: { type: 'number', description: 'Max results (default: 5)' },
    },
    required: ['query'],
  },
  async execute(args, context) {
    const memories = await context.memory.recall(
      context.userId,
      args.query as string,
      (args.limit as number) || 5
    );
    if (memories.length === 0) {
      return { success: true, output: 'No memories found for this query.' };
    }
    const lines = memories.map(m =>
      `[${m.category}|importance:${m.importance}] ${m.key}: ${m.value}`
    );
    return { success: true, output: lines.join('\n'), data: memories };
  },
};

const forget: ToolDefinition = {
  name: 'forget',
  description: 'Remove a specific memory by key.',
  parameters: {
    type: 'object',
    properties: {
      key: { type: 'string', description: 'The key of the memory to forget' },
    },
    required: ['key'],
  },
  async execute(args, context) {
    await context.memory.forget(context.userId, args.key as string);
    return { success: true, output: `🗑️ 已忘記: ${args.key}` };
  },
};

const listMemories: ToolDefinition = {
  name: 'list_memories',
  description: 'List all stored memories for the current user.',
  parameters: {
    type: 'object',
    properties: {
      category: {
        type: 'string',
        enum: ['preference', 'fact', 'context', 'skill'],
        description: 'Filter by category (optional)',
      },
    },
  },
  async execute(args, context) {
    const category = args.category as string | undefined;
    const memories = category
      ? await context.memory.recallByCategory(context.userId, category as any)
      : await context.memory.getAllMemories(context.userId);

    if (memories.length === 0) {
      return { success: true, output: 'No memories stored.' };
    }

    const lines = memories.map(m =>
      `[${m.category}] ${m.key}: ${m.value} (importance: ${m.importance})`
    );
    return { success: true, output: `🧠 ${memories.length} memories:\n${lines.join('\n')}` };
  },
};

const skill: SkillDefinition = {
  name: 'memory',
  version: '1.0.0',
  description: 'Memory management: remember, recall, forget user information',
  systemPromptAddition: `You have memory tools to persist information across conversations.
Use 'remember' proactively to store user preferences, facts, and context.
Use 'recall' before answering if you think you might have relevant stored info.
Categories: preference (likes/dislikes), fact (name, job), context (projects, events), skill (learned behaviors).`,
  tools: [remember, recall, forget, listMemories],
};

export default skill;
