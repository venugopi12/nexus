import type { EventDto } from '@nexus/shared';

export interface EventFilter {
  q?: string;
  types?: string[];
  severities?: string[];
  services?: string[];
  from?: number;
  to?: number;
}

export function matchesFilter(e: EventDto, f: EventFilter): boolean {
  if (f.types?.length && !f.types.includes(e.type)) return false;
  if (f.severities?.length && !f.severities.includes(e.severity)) return false;
  if (f.services?.length && !f.services.includes(e.serviceKey)) return false;
  if (f.from !== undefined && e.ts < f.from) return false;
  if (f.to !== undefined && e.ts > f.to) return false;
  if (f.q) {
    const q = f.q.toLowerCase();
    if (!e.message.toLowerCase().includes(q) && !e.serviceName.toLowerCase().includes(q) && !e.type.includes(q)) return false;
  }
  return true;
}

/**
 * Bounded, de-duplicating, time-ordered (newest first) buffer.
 * - Duplicate ids (re-delivery after reconnect) are dropped.
 * - Out-of-order arrivals are inserted at the correct position.
 * - Memory is capped: the oldest entries are evicted along with their ids in the dedupe set.
 */
export class EventBuffer {
  private items: EventDto[] = [];
  private ids = new Set<string>();
  constructor(private capacity = 5000) {}

  get size() { return this.items.length; }
  snapshot(): EventDto[] { return this.items; }

  /** Returns the number of newly-added events. */
  push(batch: EventDto[]): number {
    let added = 0;
    const fresh: EventDto[] = [];
    for (const e of batch) {
      if (this.ids.has(e.id)) continue;
      this.ids.add(e.id);
      fresh.push(e);
      added++;
    }
    if (!added) return 0;
    fresh.sort((a, b) => b.ts - a.ts || (a.id < b.id ? 1 : -1));
    // fast path: everything newer than current head
    if (!this.items.length || fresh[fresh.length - 1]!.ts >= this.items[0]!.ts) {
      this.items = fresh.concat(this.items);
    } else {
      this.items = this.items.concat(fresh).sort((a, b) => b.ts - a.ts || (a.id < b.id ? 1 : -1));
    }
    if (this.items.length > this.capacity) {
      const evicted = this.items.splice(this.capacity);
      for (const e of evicted) this.ids.delete(e.id);
    }
    return added;
  }

  clear() { this.items = []; this.ids.clear(); }
}
