// ============================================================
// WebChat Channel Adapter
// Simple web-based chat UI for testing without external services
// ============================================================

import express from 'express';
import { ChannelAdapter, IncomingMessage, OutgoingMessage } from '../core/types.js';
import { logger } from '../utils/logger.js';
import { v4 as uuid } from 'uuid';

interface WebChatConfig {
  port: number;
}

export class WebChatAdapter implements ChannelAdapter {
  readonly type = 'webchat' as const;
  private config: WebChatConfig;
  private messageHandler?: (msg: IncomingMessage) => Promise<void>;
  private app: express.Express;
  private server?: ReturnType<express.Express['listen']>;
  private pendingResponses: Map<string, (text: string) => void> = new Map();

  constructor(config: WebChatConfig, existingApp?: express.Express) {
    this.config = config;
    this.app = existingApp || express();
  }

  async initialize(): Promise<void> {
    this.app.use(express.json());

    // Serve chat UI
    this.app.get('/', (_req, res) => {
      res.send(CHAT_HTML);
    });

    // Chat API endpoint
    this.app.post('/api/chat', async (req, res) => {
      const { text, userId, userName } = req.body;
      if (!text) {
        res.status(400).json({ error: 'text is required' });
        return;
      }

      const msgId = uuid();
      const incoming: IncomingMessage = {
        id: msgId,
        channelType: 'webchat',
        channelId: 'webchat-default',
        userId: `webchat:${userId || 'anonymous'}`,
        userName: userName || 'Web User',
        text,
        timestamp: new Date(),
      };

      if (this.messageHandler) {
        // Create promise that will be resolved when sendMessage is called
        const responsePromise = new Promise<string>((resolve) => {
          this.pendingResponses.set(incoming.userId, resolve);
          // Timeout after 60 seconds
          setTimeout(() => {
            if (this.pendingResponses.has(incoming.userId)) {
              this.pendingResponses.delete(incoming.userId);
              resolve('⏱️ 回應超時，請稍後再試。');
            }
          }, 60000);
        });

        await this.messageHandler(incoming);
        const response = await responsePromise;
        res.json({ reply: response });
      } else {
        res.json({ reply: 'No handler configured' });
      }
    });

    // Status endpoint
    this.app.get('/api/status', (_req, res) => {
      res.json({ status: 'ok', channel: 'webchat', timestamp: new Date() });
    });

    if (!this.server) {
      this.server = this.app.listen(this.config.port, () => {
        logger.info(`🟢 WebChat UI: http://localhost:${this.config.port}`);
      });
    }
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void {
    this.messageHandler = handler;
  }

  async sendMessage(msg: OutgoingMessage): Promise<void> {
    const userId = `webchat:${msg.channelId === 'webchat-default' ? 'anonymous' : msg.channelId}`;
    // Try all possible user IDs
    for (const [key, resolve] of this.pendingResponses) {
      if (key.startsWith('webchat:')) {
        resolve(msg.text);
        this.pendingResponses.delete(key);
        return;
      }
    }
  }

  async shutdown(): Promise<void> {
    if (this.server) {
      this.server.close();
      logger.info('WebChat adapter shut down');
    }
  }

  getExpressApp(): express.Express {
    return this.app;
  }
}

// Built-in chat UI
const CHAT_HTML = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>🦞 OpenClaw Lite - Chat</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #0f0f0f; color: #e0e0e0; height: 100vh;
    display: flex; flex-direction: column;
  }
  header {
    background: #1a1a2e; padding: 16px 24px;
    border-bottom: 1px solid #333; display: flex; align-items: center; gap: 12px;
  }
  header h1 { font-size: 1.2rem; font-weight: 600; }
  header .status { width: 10px; height: 10px; border-radius: 50%; background: #00ff88; }
  #chat {
    flex: 1; overflow-y: auto; padding: 20px; display: flex;
    flex-direction: column; gap: 12px;
  }
  .msg {
    max-width: 75%; padding: 12px 16px; border-radius: 16px;
    line-height: 1.5; white-space: pre-wrap; word-break: break-word;
    animation: fadeIn 0.3s ease;
  }
  .msg.user {
    align-self: flex-end; background: #e65100; color: white;
    border-bottom-right-radius: 4px;
  }
  .msg.bot {
    align-self: flex-start; background: #1e1e2e;
    border: 1px solid #333; border-bottom-left-radius: 4px;
  }
  .msg.bot .name { font-size: 0.75rem; color: #ff6b35; margin-bottom: 4px; }
  .typing { align-self: flex-start; color: #888; font-style: italic; padding: 8px 16px; }
  #input-area {
    padding: 16px 24px; background: #1a1a1a;
    border-top: 1px solid #333; display: flex; gap: 12px;
  }
  #input {
    flex: 1; padding: 12px 16px; border-radius: 24px; border: 1px solid #444;
    background: #2a2a2a; color: #fff; font-size: 1rem; outline: none;
  }
  #input:focus { border-color: #e65100; }
  #send {
    padding: 12px 24px; border-radius: 24px; border: none;
    background: #e65100; color: white; font-weight: 600;
    cursor: pointer; font-size: 1rem;
  }
  #send:hover { background: #ff6b35; }
  #send:disabled { opacity: 0.5; cursor: not-allowed; }
  @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
</style>
</head>
<body>
<header>
  <span style="font-size:1.5rem">🦞</span>
  <h1>OpenClaw Lite</h1>
  <div class="status"></div>
  <span style="font-size:0.8rem;color:#888">Local AI Assistant</span>
</header>
<div id="chat">
  <div class="msg bot"><div class="name">🦞 ClawBot</div>你好！我是你的 AI 助理。輸入 /help 查看可用指令。</div>
</div>
<div id="input-area">
  <input id="input" placeholder="輸入訊息..." autocomplete="off" />
  <button id="send">送出</button>
</div>
<script>
const chat = document.getElementById('chat');
const input = document.getElementById('input');
const sendBtn = document.getElementById('send');

async function send() {
  const text = input.value.trim();
  if (!text) return;

  addMsg(text, 'user');
  input.value = '';
  sendBtn.disabled = true;

  const typing = document.createElement('div');
  typing.className = 'typing';
  typing.textContent = '🦞 正在思考...';
  chat.appendChild(typing);
  chat.scrollTop = chat.scrollHeight;

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, userId: 'web-user', userName: 'Web User' }),
    });
    const data = await res.json();
    typing.remove();
    addMsg(data.reply, 'bot');
  } catch (e) {
    typing.remove();
    addMsg('❌ 連線錯誤: ' + e.message, 'bot');
  }
  sendBtn.disabled = false;
  input.focus();
}

function addMsg(text, type) {
  const div = document.createElement('div');
  div.className = 'msg ' + type;
  if (type === 'bot') {
    div.innerHTML = '<div class="name">🦞 ClawBot</div>' + escapeHtml(text);
  } else {
    div.textContent = text;
  }
  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
}

function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

sendBtn.addEventListener('click', send);
input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
input.focus();
</script>
</body>
</html>`;
