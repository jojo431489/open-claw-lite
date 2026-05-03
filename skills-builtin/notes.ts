// ============================================================
// Built-in Skill: Notes & Todo
// Provides: note taking, todo list management
// ============================================================

import fs from 'fs';
import path from 'path';
import { SkillDefinition, ToolDefinition } from '../core/types.js';

const NOTES_DIR = './data/notes';
const TODO_FILE = './data/todos.json';

function ensureDir() {
  if (!fs.existsSync(NOTES_DIR)) fs.mkdirSync(NOTES_DIR, { recursive: true });
}

function loadTodos(): Array<{ id: number; text: string; done: boolean; createdAt: string }> {
  try {
    return JSON.parse(fs.readFileSync(TODO_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function saveTodos(todos: any[]) {
  const dir = path.dirname(TODO_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(TODO_FILE, JSON.stringify(todos, null, 2));
}

const createNote: ToolDefinition = {
  name: 'create_note',
  description: 'Create a new note. Notes are saved as markdown files.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Note title (used as filename)' },
      content: { type: 'string', description: 'Note content in markdown' },
    },
    required: ['title', 'content'],
  },
  async execute(args) {
    ensureDir();
    const title = (args.title as string).replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_');
    const filePath = path.join(NOTES_DIR, `${title}.md`);
    const content = `# ${args.title}\n\n${args.content}\n\n---\n_Created: ${new Date().toLocaleString()}_\n`;
    fs.writeFileSync(filePath, content);
    return { success: true, output: `📝 Note created: ${title}.md` };
  },
};

const listNotes: ToolDefinition = {
  name: 'list_notes',
  description: 'List all saved notes.',
  parameters: { type: 'object', properties: {} },
  async execute() {
    ensureDir();
    const files = fs.readdirSync(NOTES_DIR).filter(f => f.endsWith('.md'));
    if (files.length === 0) return { success: true, output: 'No notes found.' };
    return { success: true, output: files.map(f => `📝 ${f}`).join('\n') };
  },
};

const readNote: ToolDefinition = {
  name: 'read_note',
  description: 'Read a saved note by title.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Note title (filename without .md)' },
    },
    required: ['title'],
  },
  async execute(args) {
    ensureDir();
    const title = (args.title as string).replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '_');
    const filePath = path.join(NOTES_DIR, `${title}.md`);
    if (!fs.existsSync(filePath)) {
      return { success: false, output: '', error: `Note not found: ${title}` };
    }
    return { success: true, output: fs.readFileSync(filePath, 'utf-8') };
  },
};

const addTodo: ToolDefinition = {
  name: 'add_todo',
  description: 'Add a new todo item.',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Todo item text' },
    },
    required: ['text'],
  },
  async execute(args) {
    const todos = loadTodos();
    const id = todos.length > 0 ? Math.max(...todos.map(t => t.id)) + 1 : 1;
    todos.push({ id, text: args.text as string, done: false, createdAt: new Date().toISOString() });
    saveTodos(todos);
    return { success: true, output: `✅ Todo #${id} added: ${args.text}` };
  },
};

const listTodos: ToolDefinition = {
  name: 'list_todos',
  description: 'List all todo items.',
  parameters: {
    type: 'object',
    properties: {
      showDone: { type: 'boolean', description: 'Include completed items (default: true)' },
    },
  },
  async execute(args) {
    const todos = loadTodos();
    const showDone = args.showDone !== false;
    const filtered = showDone ? todos : todos.filter(t => !t.done);
    if (filtered.length === 0) return { success: true, output: '📋 No todos!' };
    const lines = filtered.map(t => {
      const check = t.done ? '✅' : '⬜';
      return `${check} #${t.id} ${t.text}`;
    });
    return { success: true, output: `📋 Todos:\n${lines.join('\n')}` };
  },
};

const completeTodo: ToolDefinition = {
  name: 'complete_todo',
  description: 'Mark a todo item as done.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'number', description: 'Todo item ID to complete' },
    },
    required: ['id'],
  },
  async execute(args) {
    const todos = loadTodos();
    const todo = todos.find(t => t.id === args.id);
    if (!todo) return { success: false, output: '', error: `Todo #${args.id} not found` };
    todo.done = true;
    saveTodos(todos);
    return { success: true, output: `✅ Completed: #${todo.id} ${todo.text}` };
  },
};

const skill: SkillDefinition = {
  name: 'notes',
  version: '1.0.0',
  description: 'Notes & Todo management: create notes, manage todo lists',
  systemPromptAddition: `You have note-taking and todo tools.
Use create_note/read_note/list_notes for saving and retrieving notes as markdown.
Use add_todo/list_todos/complete_todo for todo list management.
Proactively offer to save important information as notes.`,
  tools: [createNote, listNotes, readNote, addTodo, listTodos, completeTodo],
};

export default skill;
