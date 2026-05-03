// ============================================================
// Skill Manager - Dynamic plugin system
// Skills are bundles of tools + system prompt additions
// Can be loaded from JS/TS files or Markdown definitions
// ============================================================

import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { SkillDefinition, ToolDefinition, AppConfig } from '../core/types.js';
import { eventBus } from '../core/events.js';
import { logger } from '../utils/logger.js';

export class SkillManager {
  private skills: Map<string, SkillDefinition> = new Map();
  private allTools: Map<string, ToolDefinition> = new Map();

  constructor(private config: AppConfig) {}

  async loadBuiltinSkills(): Promise<void> {
    if (!this.config.skills.enabled) {
      logger.info('Skills system disabled');
      return;
    }

    const dir = this.config.skills.directory;
    if (!fs.existsSync(dir)) {
      logger.warn(`Skills directory not found: ${dir}`);
      return;
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.ts'))) {
        try {
          await this.loadSkillFromFile(path.join(dir, entry.name));
        } catch (err) {
          logger.error(`Failed to load skill ${entry.name}: ${err}`);
        }
      }
    }
    logger.info(`Loaded ${this.skills.size} skills with ${this.allTools.size} tools`);
  }

  async loadSkillFromFile(filePath: string): Promise<void> {
    const absPath = path.resolve(filePath);
    const url = pathToFileURL(absPath).href;
    const mod = await import(url);
    const skill: SkillDefinition = mod.default || mod.skill;

    if (!skill?.name || !skill?.tools) {
      throw new Error(`Invalid skill definition in ${filePath}`);
    }

    await this.registerSkill(skill);
  }

  async registerSkill(skill: SkillDefinition): Promise<void> {
    if (this.skills.has(skill.name)) {
      logger.warn(`Skill ${skill.name} already loaded, replacing`);
      await this.unloadSkill(skill.name);
    }

    // Register skill and its tools
    this.skills.set(skill.name, skill);
    for (const tool of skill.tools) {
      const qualifiedName = `${skill.name}.${tool.name}`;
      this.allTools.set(qualifiedName, tool);
      // Also register without prefix for convenience
      if (!this.allTools.has(tool.name)) {
        this.allTools.set(tool.name, tool);
      }
    }

    if (skill.onLoad) await skill.onLoad();
    await eventBus.emit('skill:loaded', { name: skill.name, tools: skill.tools.map(t => t.name) });
    logger.info(`Skill loaded: ${skill.name} v${skill.version} (${skill.tools.length} tools)`);
  }

  async unloadSkill(name: string): Promise<void> {
    const skill = this.skills.get(name);
    if (!skill) return;

    if (skill.onUnload) await skill.onUnload();

    for (const tool of skill.tools) {
      this.allTools.delete(`${name}.${tool.name}`);
      // Only remove unqualified name if it points to this skill's tool
      const existing = this.allTools.get(tool.name);
      if (existing === tool) this.allTools.delete(tool.name);
    }

    this.skills.delete(name);
    await eventBus.emit('skill:unloaded', { name });
    logger.info(`Skill unloaded: ${name}`);
  }

  getSkill(name: string): SkillDefinition | undefined {
    return this.skills.get(name);
  }

  getAllSkills(): SkillDefinition[] {
    return Array.from(this.skills.values());
  }

  getTool(name: string): ToolDefinition | undefined {
    return this.allTools.get(name);
  }

  getAllTools(): ToolDefinition[] {
    // Return unique tools (prefer unqualified names)
    const seen = new Set<string>();
    const tools: ToolDefinition[] = [];
    for (const [key, tool] of this.allTools) {
      if (!key.includes('.') && !seen.has(tool.name)) {
        seen.add(tool.name);
        tools.push(tool);
      }
    }
    // Add any only available via qualified name
    for (const [key, tool] of this.allTools) {
      if (!seen.has(tool.name)) {
        seen.add(tool.name);
        tools.push(tool);
      }
    }
    return tools;
  }

  /** Build system prompt additions from all loaded skills */
  getSystemPromptAdditions(): string {
    const additions: string[] = [];
    for (const skill of this.skills.values()) {
      if (skill.systemPromptAddition) {
        additions.push(`[Skill: ${skill.name}]\n${skill.systemPromptAddition}`);
      }
    }
    return additions.join('\n\n');
  }

  /** List skills info for display */
  getSkillsSummary(): string {
    if (this.skills.size === 0) return 'No skills loaded.';
    const lines = ['📦 Loaded Skills:'];
    for (const skill of this.skills.values()) {
      const toolNames = skill.tools.map(t => t.name).join(', ');
      lines.push(`  • ${skill.name} v${skill.version} - ${skill.description}`);
      lines.push(`    Tools: ${toolNames}`);
    }
    return lines.join('\n');
  }
}
