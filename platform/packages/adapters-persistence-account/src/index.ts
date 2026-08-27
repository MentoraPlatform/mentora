/**
 * @mentora/adapters-persistence-account — the PostgreSQL/Prisma adapter of
 * the Account registries (Lot A04; reference: adapters-persistence-identity,
 * divergences justified in schema.prisma and the concurrency guard).
 * PR-1: schema, migration 0001, client, serializers, mappers, fact-stream,
 * outbox, retention engines, module. PR-2 adds the repository facades, the
 * read adapters, the relay source, the PrismaChoreographyStore and the
 * integration replay of the four contract suites.
 */

export * from './client/account-prisma-client.js';
export * from './errors/account-persistence-errors.js';
export * from './serialization/account-snapshot-serializer.js';
export * from './snapshot/account-snapshot-mappers.js';
export * from './fact-stream/account-fact-mapper.js';
export * from './fact-stream/account-fact-stream-store.js';
export * from './outbox/account-outbox-store.js';
export * from './concurrency/account-optimistic-concurrency-guard.js';
export * from './retention/account-retention-engines.js';
export * from './module/account-persistence-module.js';
export * from './repository/prisma-account-repository-adapters.js';
export * from './read-model/prisma-account-state-read-adapter.js';
export * from './relay/prisma-account-relay-source.js';
export * from './choreography/prisma-choreography-store.js';
