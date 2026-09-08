import type { Event } from './types.js';

type Handler = (event: Event) => Promise<void> | void;
type ErrorHandler = (error: unknown, event: Event, handler: Handler) => void;

export class EventBus {
  private subscribers = new Map<string, Set<Handler>>();
  private onError?: ErrorHandler;

  constructor(options?: { onError?: ErrorHandler }) {
    this.onError = options?.onError;
  }

  subscribe(topic: string, handler: Handler): () => void {
    const set = this.subscribers.get(topic) ?? new Set<Handler>();
    set.add(handler);
    this.subscribers.set(topic, set);
    return () => {
      set.delete(handler);
      if (set.size === 0) this.subscribers.delete(topic);
    };
  }

  on(topic: string, handler: Handler): () => void {
    return this.subscribe(topic, handler);
  }

  async publish(event: Event): Promise<void> {
    const exact = this.subscribers.get(event.topic) ?? new Set<Handler>();
    const wildcard = this.subscribers.get('*') ?? new Set<Handler>();
    const handlers = [...new Set([...exact, ...wildcard])];

    const results = await Promise.allSettled(
      handlers.map(async (handler) => {
        try {
          await handler(event);
        } catch (err) {
          if (this.onError) {
            this.onError(err, event, handler);
          } else {
            console.error(`[EventBus] Handler error on topic '${event.topic}':`, err);
          }
          throw err;
        }
      })
    );

    // Note: We don't rethrow here so that other publishers / pipeline isn't abruptly broken,
    // achieving Failure Isolation between event listeners.
  }

  waitFor(predicate: (event: Event) => boolean, timeoutMs = 15000): Promise<Event> {
    return new Promise<Event>((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new Error(`Timed out waiting for event after ${timeoutMs}ms`));
      }, timeoutMs);

      const unsubscribe = this.subscribe('*', (event) => {
        try {
          if (predicate(event)) {
            clearTimeout(timer);
            unsubscribe();
            resolve(event);
          }
        } catch (err) {
          clearTimeout(timer);
          unsubscribe();
          reject(err);
        }
      });
    });
  }
}

