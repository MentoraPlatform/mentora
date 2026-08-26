import { nodeVitestPreset } from '@mentora/testing-config';
import { mergeConfig } from 'vitest/config';

// Two spec files (integration, relay-source) share ONE physical test
// database and truncate the same tables: files must run one at a time.
// Timeouts sized for the cold gate. Generated Prisma client excluded from
// coverage (vendor floor, not this package's law).
export default mergeConfig(nodeVitestPreset(), {
  test: {
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: { exclude: ['src/generated/**', 'dist/**', '*.mjs', 'vitest.config.ts'] },
  },
});
