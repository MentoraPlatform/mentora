import {
  createAgreementPrismaClient,
  AgreementFactStreamStore,
  AgreementOutboxStore,
  AgreementPersistenceModule,
  AgreementRetentionEngine,
  type AgreementPrismaClient,
  PrismaAgreementRelaySource,
  PrismaAgreementRepositoryAdapter,
  PrismaAgreementStateReadAdapter,
} from '@mentora/adapters-persistence-agreement';
import {
  createIdentityPrismaClient,
  IdentityPersistenceModule,
  CredentialFactStreamStore,
  CredentialOutboxStore,
  CredentialRetentionEngine,
  SessionRetentionEngine,
  PrismaCredentialRepositoryAdapter,
  PrismaSessionRepositoryAdapter,
  PrismaCredentialStateReadAdapter,
  PrismaSessionStateReadAdapter,
  PrismaProofMaterialVault,
  ScryptPasswordHasher,
  type IdentityPrismaClient,
} from '@mentora/adapters-persistence-identity';
import {
  AccountFactStreamStore,
  AccountOutboxStore,
  AccountPersistenceModule,
  AccountRetentionEngine,
  AvailabilityFrameRetentionEngine,
  createAccountPrismaClient,
  PrismaAccountRepositoryAdapter,
  PrismaAccountStateReadAdapter,
  PrismaAvailabilityFrameRepositoryAdapter,
  PrismaChoreographyStore,
  PrismaSubscriptionRepositoryAdapter,
  PrismaSupportRequestRepositoryAdapter,
  SubscriptionRetentionEngine,
  SupportRequestRetentionEngine,
  type AccountPrismaClient,
} from '@mentora/adapters-persistence-account';
import type { AccountAssembly } from '@mentora/application-account';
import { composeAccount, DevelopmentNoSettlementAdapter } from '@mentora/application-account';
import type { AgreementAssembly } from '@mentora/application-agreement';
import { composeAgreement } from '@mentora/application-agreement';
import type { IdentityAccessAssembly } from '@mentora/application-identity';
import { composeIdentityAccess } from '@mentora/application-identity';
import type { SequenceJournalPort, ReadJournalPort } from '@mentora/application-kernel';
import type { ActorRef } from '@mentora/contracts';
import type { Clock } from '@mentora/kernel';
import { RuntimeBuilder } from '@mentora/runtime-bootstrap';
import type { RuntimeContainer } from '@mentora/runtime-bootstrap';
import { SystemClock } from '@mentora/runtime-clock';
import { HealthRegistry } from '@mentora/runtime-health';
import { UuidFactory } from '@mentora/runtime-identity';
import { consoleSink, createLoggerFactory } from '@mentora/runtime-logging';
import type { LoggerFactory } from '@mentora/runtime-logging';
import type { LogSink } from '@mentora/runtime-logging';
import type { MetricsRegistry } from '@mentora/runtime-metrics';
import { createMetricsRegistry } from '@mentora/runtime-metrics';
import {
  RelayDispatch,
  RelayHealth,
  RelayMetrics,
  RelayRetryEngine,
  RuntimeRelayModule,
} from '@mentora/runtime-relay';
import type { RelayPacer, RelayPublisherPort } from '@mentora/runtime-relay';
import { cryptoTraceIdSource, MemorySpanSink, RuntimeTrace } from '@mentora/runtime-tracing';

import type { ServerConfig } from '../config/server-config.js';
import { GatewayRouter } from '../gateway/gateway-router.js';
import { ProofVerifier } from '../gateway/proof-verifier.js';
import { SessionGate } from '../gateway/session-gate.js';
import { serverHealth } from '../health/server-health.js';
import { EmptyRoutingPublisher } from '../modules/empty-routing-publisher.js';
import { HttpServerModule } from '../modules/http-server-module.js';
import {
  LoggingReactionJournal,
  LoggingReadJournal,
  LoggingSequenceJournal,
} from '../modules/logging-journals.js';

/**
 * THE COMPOSITION ROOT of the Mentora server — F4.4 §2: "le seul endroit du
 * système où des types concrets existent"; unique to THIS executable
 * (F4.4.99). Pure DI: the whole graph is built EXPLICITLY below — no
 * service locator, no resolve(), no get(). It builds the machinery, never
 * a truth (I-3).
 *
 * Dev-species note (F5.1 §3): this executable hosts the Application AND the
 * Relay — the mixed executable is "toléré en développement local";
 * production splits the species. SIGNALED.
 */

export interface ServerOverrides {
  readonly logSink?: LogSink;
  readonly clock?: Clock;
  readonly publisher?: RelayPublisherPort;
  readonly relayPacer?: RelayPacer;
  readonly httpPort?: number;
}

export interface ServerGraph {
  readonly container: RuntimeContainer;
  readonly assembly: AgreementAssembly;
  readonly identity: IdentityAccessAssembly;
  readonly account: AccountAssembly;
  readonly prisma: AgreementPrismaClient;
  readonly identityPrisma: IdentityPrismaClient;
  readonly accountPrisma: AccountPrismaClient;
  /** The dev-vault of proof material — the ACL of the Account stores here (stand-in until A05). */
  readonly proofVault: PrismaProofMaterialVault;
  readonly loggers: LoggerFactory;
  readonly metrics: MetricsRegistry;
  readonly health: HealthRegistry;
  readonly http: HttpServerModule;
}

export const composeServer = (config: ServerConfig, overrides: ServerOverrides = {}): ServerGraph => {
  // ---- (3-8) machinery: logger, metrics, tracing, health, clock, identity.
  const clock = overrides.clock ?? new SystemClock();
  const loggers = createLoggerFactory({
    clock,
    sink: overrides.logSink ?? consoleSink,
    threshold: config.MENTORA_LOG_THRESHOLD as 'debug' | 'info' | 'warn' | 'error',
  });
  const rootLogger = loggers.loggerFor('server');
  const metrics = createMetricsRegistry(clock);
  const tracer = new RuntimeTrace({
    clock,
    source: cryptoTraceIdSource,
    sink: new MemorySpanSink(), // the telemetry well is interchangeable (O-10); a real well is an adapter.
  });
  const identity = new UuidFactory();

  // ---- (9-10) the engine client + the Agreement registry (2B-1).
  const prisma = createAgreementPrismaClient(config.MENTORA_AGREEMENT_DATABASE_URL);
  const repository = new PrismaAgreementRepositoryAdapter(
    prisma,
    new AgreementRetentionEngine(
      new AgreementFactStreamStore(),
      new AgreementOutboxStore(identity),
    ),
  );
  const readAdapter = new PrismaAgreementStateReadAdapter(
    prisma,
    config.MENTORA_TIME_TOOLING_ACTOR as ActorRef,
  );

  // ---- (11) the Agreement context over the REAL implementations (1C-7).
  const commandJournal: SequenceJournalPort = new LoggingSequenceJournal(
    loggers.loggerFor('journal-command'),
  );
  const readJournal: ReadJournalPort = new LoggingReadJournal(loggers.loggerFor('journal-read'));
  const assembly = composeAgreement({
    repository,
    stateReadPort: readAdapter,
    readRightsPort: readAdapter,
    clock,
    idGenerator: identity,
    commandJournal,
    readJournal,
    product: {
      reschedule: {
        minimumNoticeMillis: config.MENTORA_PRODUCT_RESCHEDULE_MIN_NOTICE_MILLIS,
        maximumReschedules: config.MENTORA_PRODUCT_RESCHEDULE_MAX_COUNT,
      },
      cancellation: { minimumNoticeMillis: config.MENTORA_PRODUCT_CANCEL_MIN_NOTICE_MILLIS },
    },
    technical: { commandMaxAttempts: config.MENTORA_COMMAND_MAX_ATTEMPTS },
  });

  // ---- (11b) the Identity & Access context over ITS real registries
  // (Sprint 2) — the vestibule of persons (F5.4 chain of proof (1)).
  const identityPrisma = createIdentityPrismaClient(config.MENTORA_IDENTITY_DATABASE_URL);
  const credentialRepository = new PrismaCredentialRepositoryAdapter(
    identityPrisma,
    new CredentialRetentionEngine(
      new CredentialFactStreamStore(),
      new CredentialOutboxStore(identity),
    ),
  );
  const sessionRepository = new PrismaSessionRepositoryAdapter(
    identityPrisma,
    new SessionRetentionEngine(),
  );
  const credentialStateRead = new PrismaCredentialStateReadAdapter(identityPrisma);
  const sessionStateRead = new PrismaSessionStateReadAdapter(identityPrisma);
  const identityAssembly = composeIdentityAccess({
    credentialRepository,
    sessionRepository,
    credentialStateRead,
    sessionStateRead,
    clock,
    commandJournal,
    product: {
      proofRequirement: {
        acceptedStrengths: config.MENTORA_PRODUCT_PROOF_ACCEPTED_STRENGTHS.split(',')
          .map((value) => value.trim())
          .filter((value) => value !== ''),
        // MFA (Story #111/#113): 'a+b=c' entries — the PRODUCT's declared
        // composition table, judged by the ratified policy, never here.
        compositions: config.MENTORA_PRODUCT_PROOF_COMPOSITIONS.split(',')
          .map((value) => value.trim())
          .filter((value) => value.includes('='))
          .map((entry) => {
            const [left, yields] = entry.split('=');
            return { of: (left ?? '').split('+').map((value) => value.trim()), yields: (yields ?? '').trim() };
          }),
      },
    },
    technical: { commandMaxAttempts: config.MENTORA_COMMAND_MAX_ATTEMPTS },
  });

  // ---- (11b'') the ACCOUNT context over ITS real registries (Lot A04) —
  // the person's truth, the only business OHS. The gateway does NOT admit
  // its commands yet (A05: entry + emitter grid); the assembly is composed,
  // boot-validated and lifecycle-owned from THIS lot on.
  const accountPrisma = createAccountPrismaClient(config.MENTORA_ACCOUNT_DATABASE_URL);
  const accountFactStream = new AccountFactStreamStore();
  const accountOutbox = new AccountOutboxStore(identity);
  const accountAssembly = composeAccount({
    accountRepository: new PrismaAccountRepositoryAdapter(
      accountPrisma,
      new AccountRetentionEngine(accountFactStream, accountOutbox),
    ),
    availabilityFrameRepository: new PrismaAvailabilityFrameRepositoryAdapter(
      accountPrisma,
      new AvailabilityFrameRetentionEngine(accountFactStream, accountOutbox),
    ),
    subscriptionRepository: new PrismaSubscriptionRepositoryAdapter(
      accountPrisma,
      new SubscriptionRetentionEngine(accountFactStream, accountOutbox),
    ),
    supportRequestRepository: new PrismaSupportRequestRepositoryAdapter(
      accountPrisma,
      new SupportRequestRetentionEngine(),
    ),
    availabilityFrameRead: new PrismaAccountStateReadAdapter(
      accountPrisma,
      config.MENTORA_NOTIFICATION_ACTOR as ActorRef,
    ),
    reachabilityRead: new PrismaAccountStateReadAdapter(
      accountPrisma,
      config.MENTORA_NOTIFICATION_ACTOR as ActorRef,
    ),
    readRights: new PrismaAccountStateReadAdapter(
      accountPrisma,
      config.MENTORA_NOTIFICATION_ACTOR as ActorRef,
    ),
    choreographyStore: new PrismaChoreographyStore(accountPrisma, () => clock.now().epochMillis),
    // RFC-003 P4 / CTO order: the PROVISIONAL adapter refuses to exist
    // outside development — a staging/production Root must provide the
    // real Settlement adapter or die at assembly (fail closed).
    settlement: new DevelopmentNoSettlementAdapter(config.MENTORA_ENVIRONMENT),
    clock,
    commandJournal,
    readJournal,
    reactionJournal: new LoggingReactionJournal(loggers.loggerFor('journal-reaction')),
    choreographyActor: config.MENTORA_CHOREOGRAPHY_ACTOR as ActorRef,
    environment: config.MENTORA_ENVIRONMENT,
    product: {
      reachability: {
        admittedChannels: config.MENTORA_PRODUCT_REACHABILITY_CHANNELS.split(',')
          .map((value) => value.trim())
          .filter((value) => value !== ''),
      },
      subscription: {
        admittedOffers: config.MENTORA_PRODUCT_SUBSCRIPTION_OFFERS.split(',')
          .map((value) => value.trim())
          .filter((value) => value !== ''),
      },
    },
    technical: { commandMaxAttempts: config.MENTORA_COMMAND_MAX_ATTEMPTS },
  });

  // ---- (11b') the proof mechanisms (Story #96): scrypt digest, dev vault.
  const proofVault = new PrismaProofMaterialVault(identityPrisma, new ScryptPasswordHasher());

  // ---- (11c) the GATEWAY (I-12 entering adapter; M-9 session-bounded).
  // The authenticated surface admits the AGREEMENT commands only — the
  // identity emitters (EstablishCredential: the Account ACL; the session
  // verbs: RFC-002 emitter-rights instruction) stay un-admitted, a closed
  // door until their law is ratified.
  const gateway = new GatewayRouter(
    new SessionGate(identityAssembly.readPorts.sessionState, identityAssembly.readPorts.credentialState),
    assembly.commandDispatch,
    assembly.queryDispatch,
    identityAssembly.commandDispatch,
    identity,
    new Set(assembly.commandDispatch.commandTypes),
    new ProofVerifier(
      identityAssembly.readPorts.credentialState,
      proofVault,
      identityAssembly.policies.proofRequirement,
    ),
  );

  // ---- (12) the relay over the SQL-bound Outbox de faits (2B-2 + binding).
  const relaySource = new PrismaAgreementRelaySource(prisma);
  const relayDispatch = new RelayDispatch(
    relaySource,
    overrides.publisher ?? new EmptyRoutingPublisher(loggers.loggerFor('relay')),
    new RelayRetryEngine({
      baseDelayMillis: config.MENTORA_RELAY_RETRY_BASE_MILLIS,
      maxDelayMillis: config.MENTORA_RELAY_RETRY_MAX_MILLIS,
      maxAttempts: config.MENTORA_RELAY_RETRY_MAX_ATTEMPTS,
      jitterMillis: config.MENTORA_RELAY_RETRY_JITTER_MILLIS,
    }),
    clock,
    new RelayMetrics(metrics),
    loggers.loggerFor('relay'),
    {
      batchSize: config.MENTORA_RELAY_BATCH_SIZE,
      claimDurationMillis: config.MENTORA_RELAY_CLAIM_MILLIS,
    },
    tracer,
  );
  const relayModule = new RuntimeRelayModule(
    relayDispatch,
    config.MENTORA_RELAY_INTERVAL_MILLIS,
    ...(overrides.relayPacer !== undefined ? [overrides.relayPacer] : []),
  );

  // ---- (6) health: the closed declared list of this executable's checks.
  const health = new HealthRegistry();
  serverHealth(health, prisma, identityPrisma, new RelayHealth(relaySource, clock));

  // ---- (13-14) the container + the Application surface.
  const http = new HttpServerModule(
    overrides.httpPort ?? config.MENTORA_HTTP_PORT,
    health,
    rootLogger,
    gateway,
  );
  const container = new RuntimeBuilder()
    .withModule(new AgreementPersistenceModule(prisma))
    .withModule(new IdentityPersistenceModule(identityPrisma))
    .withModule(new AccountPersistenceModule(accountPrisma))
    .withModule(relayModule)
    .withModule(http)
    .withValidator({
      name: 'database-reachable',
      validate: async () => {
        try {
          await prisma.$queryRaw`SELECT 1`;
          return { ok: true as const, value: undefined };
        } catch (error) {
          return {
            ok: false as const,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    })
    .withValidator({
      name: 'identity-database-reachable',
      validate: async () => {
        try {
          await identityPrisma.$queryRaw`SELECT 1`;
          return { ok: true as const, value: undefined };
        } catch (error) {
          return {
            ok: false as const,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    })
    .withValidator({
      name: 'account-database-reachable',
      validate: async () => {
        try {
          await accountPrisma.$queryRaw`SELECT 1`;
          return { ok: true as const, value: undefined };
        } catch (error) {
          return {
            ok: false as const,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    })
    .build();

  return {
    container,
    assembly,
    identity: identityAssembly,
    account: accountAssembly,
    prisma,
    identityPrisma,
    accountPrisma,
    proofVault,
    loggers,
    metrics,
    health,
    http,
  };
};
