// ============================================================
// Event Bus - Pub/Sub for inter-module communication
// ============================================================

import { EventType, EventHandler, AppEvent } from './types.js';

export class EventBus {
  private handlers: Map<EventType, Set<EventHandler>> = new Map();
  private globalHandlers: Set<EventHandler> = new Set();

  on(type: EventType, handler: EventHandler): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type)!.add(handler);
    return () => this.handlers.get(type)?.delete(handler);
  }

  onAny(handler: EventHandler): () => void {
    this.globalHandlers.add(handler);
    return () => this.globalHandlers.delete(handler);
  }

  async emit(type: EventType, data: unknown): Promise<void> {
    const event: AppEvent = { type, timestamp: new Date(), data };
    const handlers = this.handlers.get(type) ?? new Set();
    const all = [...handlers, ...this.globalHandlers];
    await Promise.allSettled(all.map(h => h(event)));
  }
}

export const eventBus = new EventBus();
