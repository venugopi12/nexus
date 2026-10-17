/** Deterministic hashing + PRNG helpers. Everything in the simulator derives from these. */

/** 32-bit FNV-1a hash. */
export function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Hash of several parts to a uniform float in [0, 1). */
export function unit(...parts: (string | number)[]): number {
  let h = hash32(parts.join('|'));
  // avalanche
  h ^= h >>> 16;
  h = Math.imul(h, 0x45d9f3b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Standard normal sample (Box-Muller) derived deterministically from parts. */
export function gaussian(...parts: (string | number)[]): number {
  const u1 = Math.max(unit(...parts, 'a'), 1e-9);
  const u2 = unit(...parts, 'b');
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** mulberry32 seeded generator for sequential draws. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)] as T;
}
