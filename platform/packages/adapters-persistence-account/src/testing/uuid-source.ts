import type { IdGenerator } from '@mentora/kernel';

/**
 * A local CSPRNG UUID source for the fixture's MessageIds — the adapter
 * package does not depend on runtime-identity (the future Root injects the
 * real generator); specs need one, deterministic enough (uniqueness only).
 */
export class UuidFactory implements IdGenerator {
  generate(): string {
    return globalThis.crypto.randomUUID();
  }
}
