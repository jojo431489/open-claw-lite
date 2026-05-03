// ============================================================
// Built-in Skill: Web Tools
// Provides: HTTP fetch, URL content extraction
// ============================================================

import { SkillDefinition, ToolDefinition } from '../core/types.js';

const webFetch: ToolDefinition = {
  name: 'web_fetch',
  description: 'Fetch content from a URL. Returns the text content of the page. Useful for reading articles, APIs, documentation.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'URL to fetch' },
      method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE'], description: 'HTTP method (default: GET)' },
      headers: { type: 'object', description: 'Additional HTTP headers' },
      body: { type: 'string', description: 'Request body (for POST/PUT)' },
    },
    required: ['url'],
  },
  async execute(args) {
    try {
      const url = args.url as string;
      const method = (args.method as string) || 'GET';
      const headers = (args.headers as Record<string, string>) || {};
      const body = args.body as string | undefined;

      const response = await fetch(url, {
        method,
        headers: {
          'User-Agent': 'OpenClaw-Lite/1.0',
          ...headers,
        },
        body: method !== 'GET' ? body : undefined,
        signal: AbortSignal.timeout(15000),
      });

      const contentType = response.headers.get('content-type') || '';
      let content: string;

      if (contentType.includes('application/json')) {
        const json = await response.json();
        content = JSON.stringify(json, null, 2);
      } else {
        content = await response.text();
        // Strip HTML tags for readability
        if (contentType.includes('html')) {
          content = content
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s{2,}/g, ' ')
            .trim();
        }
      }

      return {
        success: true,
        output: content.slice(0, 6000),
        data: {
          status: response.status,
          contentType,
          contentLength: content.length,
        },
      };
    } catch (err: any) {
      return { success: false, output: '', error: err.message };
    }
  },
};

const httpRequest: ToolDefinition = {
  name: 'http_request',
  description: 'Make an HTTP API request. Returns JSON response. Good for calling REST APIs.',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'API endpoint URL' },
      method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], description: 'HTTP method' },
      headers: { type: 'object', description: 'Request headers (JSON object)' },
      body: { type: 'object', description: 'Request body (will be JSON-serialized)' },
    },
    required: ['url'],
  },
  async execute(args) {
    try {
      const url = args.url as string;
      const method = (args.method as string) || 'GET';
      const headers = (args.headers as Record<string, string>) || {};
      const body = args.body;

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30000),
      });

      const data = await response.json().catch(() => response.text());

      return {
        success: response.ok,
        output: JSON.stringify(data, null, 2).slice(0, 6000),
        data: { status: response.status, statusText: response.statusText },
      };
    } catch (err: any) {
      return { success: false, output: '', error: err.message };
    }
  },
};

const skill: SkillDefinition = {
  name: 'web',
  version: '1.0.0',
  description: 'Web tools: fetch pages, make HTTP API requests',
  systemPromptAddition: `You have web tools: web_fetch (read web pages), http_request (call REST APIs).
Use web_fetch to read articles, documentation, or any web content.
Use http_request for structured API calls with JSON bodies and responses.`,
  tools: [webFetch, httpRequest],
};

export default skill;
