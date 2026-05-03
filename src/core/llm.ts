// ============================================================
// LLM Client - Multi-provider support
// Anthropic Claude, OpenAI GPT, Ollama (local models)
// ============================================================

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import {
  LLMClient, LLMProvider, LLMOptions, LLMResponse,
  ConversationMessage, ToolDefinition, AppConfig,
} from '../core/types.js';
import { logger } from '../utils/logger.js';

// --- Anthropic Client ---
class AnthropicLLMClient implements LLMClient {
  provider: LLMProvider = 'anthropic';
  private client: Anthropic;
  private defaultModel: string;

  constructor(config: AppConfig['llm']) {
    this.client = new Anthropic({ apiKey: config.apiKey });
    this.defaultModel = config.model || 'claude-sonnet-4-20250514';
  }

  async chat(messages: ConversationMessage[], tools?: ToolDefinition[], options?: LLMOptions): Promise<LLMResponse> {
    const systemMsg = messages.find(m => m.role === 'system');
    const chatMessages = messages.filter(m => m.role !== 'system').map(m => {
      if (m.role === 'tool') {
        return {
          role: 'user' as const,
          content: [{
            type: 'tool_result' as const,
            tool_use_id: m.toolCallId || 'unknown',
            content: m.content,
          }],
        };
      }
      if (m.toolCalls && m.toolCalls.length > 0) {
        return {
          role: 'assistant' as const,
          content: [
            ...(m.content ? [{ type: 'text' as const, text: m.content }] : []),
            ...m.toolCalls.map(tc => ({
              type: 'tool_use' as const,
              id: tc.id,
              name: tc.name,
              input: JSON.parse(tc.arguments),
            })),
          ],
        };
      }
      return { role: m.role as 'user' | 'assistant', content: m.content };
    });

    const anthropicTools = tools?.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as any,
    }));

    const response = await this.client.messages.create({
      model: options?.model || this.defaultModel,
      max_tokens: options?.maxTokens || 4096,
      temperature: options?.temperature,
      system: options?.systemPrompt || systemMsg?.content || undefined,
      messages: chatMessages as any,
      ...(anthropicTools?.length ? { tools: anthropicTools } : {}),
    });

    let content = '';
    const toolCalls: LLMResponse['toolCalls'] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        content += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input as Record<string, unknown>,
        });
      }
    }

    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
      finishReason: response.stop_reason ?? undefined,
    };
  }
}

// --- OpenAI Client ---
class OpenAILLMClient implements LLMClient {
  provider: LLMProvider = 'openai';
  private client: OpenAI;
  private defaultModel: string;

  constructor(config: AppConfig['llm']) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    });
    this.defaultModel = config.model || 'gpt-4o';
  }

  async chat(messages: ConversationMessage[], tools?: ToolDefinition[], options?: LLMOptions): Promise<LLMResponse> {
    const openaiMessages = messages.map(m => {
      if (m.role === 'tool') {
        return {
          role: 'tool' as const,
          content: m.content,
          tool_call_id: m.toolCallId || 'unknown',
        };
      }
      if (m.toolCalls && m.toolCalls.length > 0) {
        return {
          role: 'assistant' as const,
          content: m.content || null,
          tool_calls: m.toolCalls.map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: { name: tc.name, arguments: tc.arguments },
          })),
        };
      }
      return { role: m.role, content: m.content };
    });

    const openaiTools = tools?.map(t => ({
      type: 'function' as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    const response = await this.client.chat.completions.create({
      model: options?.model || this.defaultModel,
      max_tokens: options?.maxTokens || 4096,
      temperature: options?.temperature,
      messages: openaiMessages as any,
      ...(openaiTools?.length ? { tools: openaiTools } : {}),
    });

    const choice = response.choices[0];
    const toolCalls = choice.message.tool_calls?.map(tc => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
    }));

    return {
      content: choice.message.content || '',
      toolCalls: toolCalls?.length ? toolCalls : undefined,
      usage: response.usage ? {
        inputTokens: response.usage.prompt_tokens,
        outputTokens: response.usage.completion_tokens,
      } : undefined,
      finishReason: choice.finish_reason ?? undefined,
    };
  }
}

// --- Ollama Client (local models via OpenAI-compatible API) ---
class OllamaLLMClient extends OpenAILLMClient {
  constructor(config: AppConfig['llm']) {
    super({
      ...config,
      apiKey: 'ollama',
      baseUrl: config.baseUrl || 'http://localhost:11434/v1',
      model: config.model || 'llama3.2',
    });
    this.provider = 'ollama';
  }
}

// --- Factory ---
export function createLLMClient(config: AppConfig['llm']): LLMClient {
  switch (config.provider) {
    case 'anthropic':
      logger.info(`LLM: Anthropic (${config.model})`);
      return new AnthropicLLMClient(config);
    case 'openai':
      logger.info(`LLM: OpenAI (${config.model})`);
      return new OpenAILLMClient(config);
    case 'ollama':
      logger.info(`LLM: Ollama local (${config.model})`);
      return new OllamaLLMClient(config);
    case 'custom':
      logger.info(`LLM: Custom OpenAI-compatible (${config.baseUrl})`);
      return new OpenAILLMClient(config);
    default:
      throw new Error(`Unsupported LLM provider: ${config.provider}`);
  }
}
