import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { server: 'src/server.ts', seed: 'src/seed/index.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  clean: true,
  sourcemap: true,
  // workspace package ships TypeScript source, so it must be bundled; everything else stays external
  noExternal: ['@nexus/shared'],
});
