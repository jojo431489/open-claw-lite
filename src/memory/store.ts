// ============================================================
// Memory System - SQLite-backed persistent memory
// Supports: preferences, facts, context, skill data
// Auto-extracts memories from conversations via LLM
// ============================================================

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { v4 as uuid } from 'uuid';
import { MemoryStore, MemoryEntry } from '../core/types.js';
import { eventBus } from '../core/events.js';
import { logger } from '../utils/logger.js';

export class SQLiteMemoryStore implements MemoryStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'fact',
        importance REAL NOT NULL DEFAULT 0.5,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        access_count INTEGER NOT NULL DEFAULT 0,
        UNIQUE(user_id, key)
      );

      CREATE INDEX IF NOT EXISTS idx_memories_user ON memories(user_id);
      CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(user_id, category);
      CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(user_id, importance DESC);

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        channel_type TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_conv_user ON conversations(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_conv_channel ON conversations(channel_type, channel_id, created_at DESC);
    `);
    logger.info('Memory store initialized');
  }

  async remember(
    userId: string,
    key: string,
    value: string,
    category: MemoryEntry['category'] = 'fact',
    importance: number = 0.5
  ): Promise<void> {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO memories (id, user_id, key, value, category, importance, created_at, updated_at, access_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
      ON CONFLICT(user_id, key) DO UPDATE SET
        value = excluded.value,
        category = excluded.category,
        importance = MAX(memories.importance, excluded.importance),
        updated_at = excluded.updated_at,
        access_count = memories.access_count + 1
    `);
    stmt.run(uuid(), userId, key, value, category, importance, now, now);
    await eventBus.emit('memory:stored', { userId, key, value, category });
    logger.debug(`Memory stored: [${userId}] ${key} = ${value.slice(0, 50)}...`);
  }

  async recall(userId: string, query: string, limit: number = 10): Promise<MemoryEntry[]> {
    // Simple keyword-based search with importance ranking
    const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 1);
    if (words.length === 0) {
      return this.recallRecent(userId, limit);
    }

    const conditions = words.map(() => `(LOWER(key) LIKE ? OR LOWER(value) LIKE ?)`).join(' OR ');
    const params: string[] = [];
    for (const word of words) {
      params.push(`%${word}%`, `%${word}%`);
    }

    const stmt = this.db.prepare(`
      SELECT * FROM memories
      WHERE user_id = ? AND (${conditions})
      ORDER BY importance DESC, updated_at DESC
      LIMIT ?
    `);
    const rows = stmt.all(userId, ...params, limit) as any[];
    const entries = rows.map(this.rowToEntry);

    // Update access counts
    if (entries.length > 0) {
      const updateStmt = this.db.prepare(`UPDATE memories SET access_count = access_count + 1 WHERE id = ?`);
      const tx = this.db.transaction(() => {
        for (const e of entries) updateStmt.run(e.id);
      });
      tx();
    }

    await eventBus.emit('memory:recalled', { userId, query, count: entries.length });
    return entries;
  }

  async recallByKey(userId: string, key: string): Promise<MemoryEntry | null> {
    const stmt = this.db.prepare(`SELECT * FROM memories WHERE user_id = ? AND key = ?`);
    const row = stmt.get(userId, key) as any;
    return row ? this.rowToEntry(row) : null;
  }

  async recallByCategory(userId: string, category: MemoryEntry['category']): Promise<MemoryEntry[]> {
    const stmt = this.db.prepare(`
      SELECT * FROM memories WHERE user_id = ? AND category = ?
      ORDER BY importance DESC, updated_at DESC
    `);
    return (stmt.all(userId, category) as any[]).map(this.rowToEntry);
  }

  async forget(userId: string, key: string): Promise<void> {
    this.db.prepare(`DELETE FROM memories WHERE user_id = ? AND key = ?`).run(userId, key);
    logger.info(`Memory forgotten: [${userId}] ${key}`);
  }

  async getAllMemories(userId: string): Promise<MemoryEntry[]> {
    const stmt = this.db.prepare(`
      SELECT * FROM memories WHERE user_id = ?
      ORDER BY importance DESC, updated_at DESC
    `);
    return (stmt.all(userId) as any[]).map(this.rowToEntry);
  }

  private recallRecent(userId: string, limit: number): MemoryEntry[] {
    const stmt = this.db.prepare(`
      SELECT * FROM memories WHERE user_id = ?
      ORDER BY updated_at DESC LIMIT ?
    `);
    return (stmt.all(userId, limit) as any[]).map(this.rowToEntry);
  }

  // --- Conversation history ---

  saveConversation(
    userId: string,
    channelType: string,
    channelId: string,
    role: string,
    content: string
  ): void {
    this.db.prepare(`
      INSERT INTO conversations (id, user_id, channel_type, channel_id, role, content, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(uuid(), userId, channelType, channelId, role, content, new Date().toISOString());
  }

  getConversationHistory(
    userId: string,
    channelType: string,
    channelId: string,
    limit: number = 20
  ): Array<{ role: string; content: string; created_at: string }> {
    const stmt = this.db.prepare(`
      SELECT role, content, created_at FROM conversations
      WHERE user_id = ? AND channel_type = ? AND channel_id = ?
      ORDER BY created_at DESC LIMIT ?
    `);
    return (stmt.all(userId, channelType, channelId, limit) as any[]).reverse();
  }

  // --- Utilities ---

  private rowToEntry(row: any): MemoryEntry {
    return {
      id: row.id,
      userId: row.user_id,
      key: row.key,
      value: row.value,
      category: row.category,
      importance: row.importance,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
      accessCount: row.access_count,
    };
  }

  close(): void {
    this.db.close();
  }
}

// --- Memory extraction prompt ---
export const MEMORY_EXTRACTION_PROMPT = `
You are a memory extraction system. Analyze the conversation and extract important information about the user that should be remembered for future conversations.

Extract memories in the following JSON format:
[
  {"key": "short_key_name", "value": "what to remember", "category": "preference|fact|context", "importance": 0.0-1.0}
]

Categories:
- preference: User preferences (language, style, likes/dislikes)
- fact: Facts about the user (name, job, location, skills)
- context: Contextual info (current projects, recent events)

Rules:
- Only extract genuinely useful information
- Keys should be descriptive and unique (e.g., "preferred_language", "job_title")
- Importance: 0.9+ for core identity, 0.7+ for strong preferences, 0.5 for general info, 0.3 for minor details
- Return empty array [] if nothing worth remembering
- Reply ONLY with valid JSON array, no other text
`;
