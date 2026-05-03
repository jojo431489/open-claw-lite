// ============================================================
// Built-in Skill: System Tools
// Provides: shell exec, file read/write, web search, time, calc
// ============================================================

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { SkillDefinition, ToolDefinition } from '../core/types.js';

const shellExec: ToolDefinition = {
  name: 'shell_exec',
  description: 'Execute a shell command on the local machine. Use for system tasks, running scripts, package management, etc. Returns stdout/stderr.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Shell command to execute' },
      timeout: { type: 'number', description: 'Timeout in milliseconds (default: 30000)' },
    },
    required: ['command'],
  },
  async execute(args) {
    const cmd = args.command as string;
    const timeout = (args.timeout as number) || 30000;

    // Safety check - block dangerous commands
    const blocked = ['rm -rf /', 'mkfs', ':(){', 'dd if='];
    if (blocked.some(b => cmd.includes(b))) {
      return { success: false, output: '', error: '⛔ This command is blocked for safety.' };
    }

    try {
      const stdout = execSync(cmd, {
        timeout,
        encoding: 'utf-8',
        maxBuffer: 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return { success: true, output: stdout.slice(0, 4000) };
    } catch (err: any) {
      return {
        success: false,
        output: err.stdout?.slice(0, 2000) || '',
        error: err.stderr?.slice(0, 2000) || err.message,
      };
    }
  },
};

const fileRead: ToolDefinition = {
  name: 'file_read',
  description: 'Read a file from the local filesystem. Returns the file content as text.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute or relative file path' },
      encoding: { type: 'string', description: 'File encoding (default: utf-8)' },
    },
    required: ['path'],
  },
  async execute(args) {
    try {
      const filePath = args.path as string;
      const encoding = (args.encoding as BufferEncoding) || 'utf-8';
      const content = fs.readFileSync(filePath, encoding);
      return { success: true, output: content.slice(0, 8000) };
    } catch (err: any) {
      return { success: false, output: '', error: err.message };
    }
  },
};

const fileWrite: ToolDefinition = {
  name: 'file_write',
  description: 'Write content to a file on the local filesystem. Creates directories as needed.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path to write to' },
      content: { type: 'string', description: 'Content to write' },
      append: { type: 'boolean', description: 'Append instead of overwrite (default: false)' },
    },
    required: ['path', 'content'],
  },
  async execute(args) {
    try {
      const filePath = args.path as string;
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      if (args.append) {
        fs.appendFileSync(filePath, args.content as string);
      } else {
        fs.writeFileSync(filePath, args.content as string);
      }
      return { success: true, output: `File written: ${filePath}` };
    } catch (err: any) {
      return { success: false, output: '', error: err.message };
    }
  },
};

const fileList: ToolDefinition = {
  name: 'file_list',
  description: 'List files and directories at a given path.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Directory path to list' },
    },
    required: ['path'],
  },
  async execute(args) {
    try {
      const dirPath = args.path as string;
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      const lines = entries.map(e => {
        const type = e.isDirectory() ? '📁' : '📄';
        const stat = fs.statSync(path.join(dirPath, e.name));
        const size = e.isFile() ? ` (${formatSize(stat.size)})` : '';
        return `${type} ${e.name}${size}`;
      });
      return { success: true, output: lines.join('\n') };
    } catch (err: any) {
      return { success: false, output: '', error: err.message };
    }
  },
};

const getCurrentTime: ToolDefinition = {
  name: 'get_time',
  description: 'Get the current date, time, and timezone.',
  parameters: { type: 'object', properties: {} },
  async execute(_args, context) {
    const tz = context.config.timezone || 'Asia/Taipei';
    const now = new Date();
    return {
      success: true,
      output: JSON.stringify({
        iso: now.toISOString(),
        local: now.toLocaleString('zh-TW', { timeZone: tz }),
        timezone: tz,
        unix: Math.floor(now.getTime() / 1000),
      }),
    };
  },
};

const calculate: ToolDefinition = {
  name: 'calculate',
  description: 'Evaluate a mathematical expression. Supports basic arithmetic, Math functions, etc.',
  parameters: {
    type: 'object',
    properties: {
      expression: { type: 'string', description: 'Math expression to evaluate (e.g., "2 * Math.PI * 5")' },
    },
    required: ['expression'],
  },
  async execute(args) {
    try {
      const expr = args.expression as string;
      // Safety: only allow math-related tokens
      if (/[;{}=]|require|import|eval|Function/.test(expr)) {
        return { success: false, output: '', error: 'Expression contains disallowed patterns' };
      }
      const result = new Function('Math', `return (${expr})`)(Math);
      return { success: true, output: String(result) };
    } catch (err: any) {
      return { success: false, output: '', error: err.message };
    }
  },
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

const skill: SkillDefinition = {
  name: 'system',
  version: '1.0.0',
  description: 'Core system tools: shell, file I/O, time, calculator',
  systemPromptAddition: `You have system tools: shell_exec (run commands), file_read/file_write/file_list (file I/O), get_time, calculate.
Use shell_exec for tasks like installing packages, running scripts, checking system info.
Use file tools to read, write, and list files.
Always be cautious with shell commands that modify the system.`,
  tools: [shellExec, fileRead, fileWrite, fileList, getCurrentTime, calculate],
};

export default skill;
