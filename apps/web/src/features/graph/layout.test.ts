import { describe, expect, it } from 'vitest';
import { layeredLayout, reach } from './layout';

const edges = [
  { source: 'edge', target: 'auth' }, { source: 'edge', target: 'checkout' }, { source: 'checkout', target: 'pay' },
  { source: 'pay', target: 'db' }, { source: 'auth', target: 'db' },
];
describe('layeredLayout', () => {
  it('places callers left of callees by longest path', () => {
    const p = layeredLayout(['edge', 'auth', 'checkout', 'pay', 'db'], edges);
    expect(p.get('edge')!.x).toBe(0);
    expect(p.get('auth')!.x).toBe(300);
    expect(p.get('db')!.x).toBe(900); // via edge → checkout → pay → db
    for (const e of edges) expect(p.get(e.source)!.x).toBeLessThan(p.get(e.target)!.x);
  });
  it('survives cycles', () => {
    const p = layeredLayout(['a', 'b'], [{ source: 'a', target: 'b' }, { source: 'b', target: 'a' }]);
    expect(p.size).toBe(2);
  });
});
describe('reach', () => {
  it('finds downstream dependencies and upstream callers transitively', () => {
    expect([...reach('checkout', edges, 'down')].sort()).toEqual(['db', 'pay']);
    expect([...reach('db', edges, 'up')].sort()).toEqual(['auth', 'checkout', 'edge', 'pay']);
    expect(reach('edge', edges, 'up').size).toBe(0);
  });
});
