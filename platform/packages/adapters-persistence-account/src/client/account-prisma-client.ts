import { PrismaClient } from '../generated/prisma/client.js';

/**
 * The engine client door of the Account registries (reference:
 * identity-prisma-client). The Root creates ONE client per executable and
 * owns its lifecycle through AccountPersistenceModule (I-11).
 */
export type AccountPrismaClient = PrismaClient;

export const createAccountPrismaClient = (databaseUrl: string): AccountPrismaClient =>
  new PrismaClient({ datasourceUrl: databaseUrl });

export { PrismaClient };
export type { Prisma } from '../generated/prisma/client.js';
