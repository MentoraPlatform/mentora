import type { RuntimeModule } from '@mentora/runtime-bootstrap';

import type { AccountPrismaClient } from '../client/account-prisma-client.js';

/**
 * AccountPersistenceModule — the lifecycle owner of the registries' engine
 * client (I-11; reference: IdentityPersistenceModule): construire →
 * démarrer → drainer → libérer, death in reverse order with everything
 * else. Crash remains are waste, never inheritance (F5.1 §19).
 */
export class AccountPersistenceModule implements RuntimeModule {
  readonly name = 'account-persistence';

  constructor(private readonly prisma: AccountPrismaClient) {}

  async construct(): Promise<void> {
    await this.prisma.$connect();
  }

  async dispose(): Promise<void> {
    await this.prisma.$disconnect();
  }
}
