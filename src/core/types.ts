// ============================================================
// OpenClaw Lite - Core Type Definitions
// ============================================================

/** Supported messaging channels */
export type ChannelType = 'line' | 'telegram' | 'discord' | 'webchat';

/** Supported LLM providers */
export type LLMProvider = 'anthropic' | 'openai' | 'ollama' | 'custom';

/** Incoming message from any channel */
export interface IncomingMessage {
  id: string;
  channelType: ChannelType;
  channelId: string;        // channel-specific chat/group ID
  userId: string;            // channel-specific user ID
  userName: string;
  text: string;
  timestamp: Date;
  replyTo?: string;          // message ID being replied to
  attachments?: Attachment[];
  raw?: unknown;             // original platform payload
}

export interface Attachment {
  type: 'image' | 'file' | 'audio' | 'video';
  url?: string;
  data?: Buffer;
  mimeType?: string;
  fileName?: string;
}

/** Outgoing message to any channel */
export interface OutgoingMessage {
  text: string;
  channelType: ChannelType;
  channelId: string;
  replyTo?: string;
  attachments?: Attachment[];
  metadata?: Record<string, unknown>;
}

/** Channel adapter interface - each platform implements this */
export interface ChannelAdapter {
  readonly type: ChannelType;
  initialize(): Promise<void>;
  sendMessage(msg: OutgoingMessage): Promise<void>;
  shutdown(): Promise<void>;
  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void;
}

/** Tool definition for LLM function calling */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;  // JSON Schema
  execute: (args: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>;
}

export interface ToolContext {
  userId: string;
  channelType: ChannelType;
  channelId: string;
  sessionId: string;
  memory: MemoryStore;
  config: AppConfig;
}

export interface ToolResult {
  success: boolean;
  output: string;
  data?: unknown;
  error?: string;
}

/** Skill definition - a bundle of tools + system prompt additions */
export interface SkillDefinition {
  name: string;
  version: string;
  description: string;
  author?: string;
  systemPromptAddition?: string;
  tools: ToolDefinition[];
  onLoad?: () => Promise<void>;
  onUnload?: () => Promise<void>;
}

/** Memory entry */
export interface MemoryEntry {
  id: string;
  userId: string;
  key: string;
  value: string;
  category: 'preference' | 'fact' | 'context' | 'skill';
  importance: number;       // 0-1, used for retrieval ranking
  createdAt: Date;
  updatedAt: Date;
  accessCount: number;
}

/** Conversation message for LLM context */
export interface ConversationMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: string;
  }>;
}

/** Memory store interface */
export interface MemoryStore {
  remember(userId: string, key: string, value: string, category: MemoryEntry['category'], importance?: number): Promise<void>;
  recall(userId: string, query: string, limit?: number): Promise<MemoryEntry[]>;
  recallByKey(userId: string, key: string): Promise<MemoryEntry | null>;
  recallByCategory(userId: string, category: MemoryEntry['category']): Promise<MemoryEntry[]>;
  forget(userId: string, key: string): Promise<void>;
  getAllMemories(userId: string): Promise<MemoryEntry[]>;
}

/** LLM Client interface */
export interface LLMClient {
  chat(messages: ConversationMessage[], tools?: ToolDefinition[], options?: LLMOptions): Promise<LLMResponse>;
  provider: LLMProvider;
}

export interface LLMOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}

export interface LLMResponse {
  content: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  finishReason?: string;
}

/** Application configuration */
export interface AppConfig {
  // General
  botName: string;
  language: string;
  timezone: string;

  // LLM
  llm: {
    provider: LLMProvider;
    model: string;
    apiKey?: string;
    baseUrl?: string;
    temperature: number;
    maxTokens: number;
  };

  // Channels
  channels: {
    line?: {
      channelAccessToken: string;
      channelSecret: string;
      port?: number;
    };
    telegram?: {
      botToken: string;
    };
    discord?: {
      botToken: string;
      applicationId: string;
    };
    webchat?: {
      port: number;
    };
  };

  // Memory
  memory: {
    enabled: boolean;
    dbPath: string;
    maxEntriesPerUser: number;
    autoExtract: boolean;       // auto-extract memories from conversations
  };

  // Skills
  skills: {
    enabled: boolean;
    directory: string;
    autoLoad: boolean;
  };

  // Server
  server: {
    port: number;
    webhookUrl?: string;       // for LINE webhook
  };

  // Security
  security: {
    allowedUsers: string[];     // empty = allow all
    adminUsers: string[];
    requireApproval: boolean;   // require approval for dangerous actions
  };
}

/** Event system */
export type EventType =
  | 'message:received'
  | 'message:sent'
  | 'tool:called'
  | 'tool:result'
  | 'memory:stored'
  | 'memory:recalled'
  | 'skill:loaded'
  | 'skill:unloaded'
  | 'error';

export interface AppEvent {
  type: EventType;
  timestamp: Date;
  data: unknown;
}

export type EventHandler = (event: AppEvent) => void | Promise<void>;
