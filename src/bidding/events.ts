import { OutboxEvent } from '../types.js';

export type EventHandler = (event: OutboxEvent) => void | Promise<void>;

class EventEmitterHub {
  private handlers: Set<EventHandler> = new Set();

  public subscribe(handler: EventHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  public async emitAll(events: OutboxEvent[]): Promise<void> {
    for (const event of events) {
      for (const handler of this.handlers) {
        try {
          await handler(event);
        } catch (err) {
          console.error('[EventEmitterHub] Error processing event in handler:', err);
        }
      }
    }
  }
}

export const eventHub = new EventEmitterHub();
