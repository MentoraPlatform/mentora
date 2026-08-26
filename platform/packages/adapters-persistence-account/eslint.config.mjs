import mentora from '@mentora/eslint-config';
import boundaries from '@mentora/eslint-config/boundaries';
import mentoraPlugin from '@mentora/eslint-plugin-mentora';

// src/generated is the Prisma emitter's output (vendor floor) — never linted.
export default [
  { ignores: ['src/generated/**'] },
  ...mentora,
  ...boundaries,
  ...mentoraPlugin.configs.constitution,
];
