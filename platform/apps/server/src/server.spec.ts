import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { SystemClock } from '@mentora/runtime-clock';
import { environmentSource, inMemorySource } from '@mentora/runtime-config';
import { HealthRegistry, healthy, unhealthy } from '@mentora/runtime-health';
import { MemoryLogSink, createLoggerFactory } from '@mentora/runtime-logging';
import type { RelayPacer } from '@mentora/runtime-relay';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { bootServer, buildServerGraph } from './bootstrap/server-bootstrap.js';
import type { ServerGraph } from './composition/server-composition.js';
import { dotEnvSource, loadServerConfig, serverConfigSources } from './config/server-config.js';
import { EmptyRoutingPublisher } from './modules/empty-routing-publisher.js';
import { HttpServerModule } from './modules/http-server-module.js';
import { startServerRuntime } from './runtime/server-runtime.js';
import { shutdownServer, wireSignals } from './shutdown/server-shutdown.js';
import type { SignalHost } from './shutdown/server-shutdown.js';
import { renderBootReport } from './startup/boot-report.js';
import { runServerProcess } from './startup/run-server-process.js';
import type { ProcessHost } from './startup/run-server-process.js';

const url = environmentSource().read('MENTORA_AGREEMENT_DATABASE_URL');
const identityUrl = environmentSource().read('MENTORA_IDENTITY_DATABASE_URL');
const accountUrl = environmentSource().read('MENTORA_ACCOUNT_DATABASE_URL');

/** Manual relay pacer: the spec drives ticks; nothing runs on wall timers. */
const manualPacer = (): { pacer: RelayPacer; tick: () => Promise<void>; stops: () => number } => {
  let fn: (() => Promise<void>) | undefined;
  let stopped = 0;
  return {
    pacer: (tick) => {
      fn = tick;
      return () => {
        stopped += 1;
      };
    },
    tick: async () => {
      await fn?.();
    },
    stops: () => stopped,
  };
};

const testSources = (extra: Record<string, string> = {}) => [
  inMemorySource('spec', {
    MENTORA_AGREEMENT_DATABASE_URL: url ?? 'postgresql://void',
    MENTORA_IDENTITY_DATABASE_URL: identityUrl ?? 'postgresql://void',
    MENTORA_ACCOUNT_DATABASE_URL: accountUrl ?? 'postgresql://void',
    MENTORA_HTTP_PORT: '0',
    MENTORA_LOG_THRESHOLD: 'error',
    ...extra,
  }),
];

describe('configuration (fail closed, COMPLETE report)', () => {
  it('loads .env + environment with declared precedence and defaults', () => {
    const loaded = loadServerConfig([
      inMemorySource('env', { MENTORA_AGREEMENT_DATABASE_URL: 'postgresql://one', MENTORA_IDENTITY_DATABASE_URL: 'postgresql://id', MENTORA_ACCOUNT_DATABASE_URL: 'postgresql://acc' }),
      inMemorySource('dotenv', {
        MENTORA_AGREEMENT_DATABASE_URL: 'postgresql://two',
        MENTORA_HTTP_PORT: '4000',
      }),
    ]);
    expect(loaded.ok && loaded.value.MENTORA_AGREEMENT_DATABASE_URL).toBe('postgresql://one');
    expect(loaded.ok && loaded.value.MENTORA_HTTP_PORT).toBe(4000);
    expect(loaded.ok && loaded.value.MENTORA_RELAY_BATCH_SIZE).toBe(25);
  });

  it('EVERY violation is listed — never only the first', () => {
    const graph = buildServerGraph([
      inMemorySource('bad', {
        MENTORA_AGREEMENT_DATABASE_URL: '  ',
        MENTORA_HTTP_PORT: 'not-a-port',
        MENTORA_LOG_THRESHOLD: 'shout',
      }),
    ]);
    expect(graph.ok).toBe(false);
    if (!graph.ok && graph.error.kind === 'configuration') {
      expect(graph.error.violations.length).toBeGreaterThanOrEqual(3);
      const report = renderBootReport(graph.error);
      expect(report).toContain('BOOT REFUSED');
      expect(report).toContain('MENTORA_HTTP_PORT');
      expect(report).toContain('MENTORA_LOG_THRESHOLD');
    }
  });

  it('an absent .env file is lawful — the environment may carry everything', () => {
    expect(dotEnvSource('no-such-file.env').read('ANYTHING')).toBeUndefined();
    expect(serverConfigSources('no-such-file.env')).toHaveLength(2);
  });
});

describe.skipIf(url === undefined)('the living process (real PostgreSQL)', () => {
  it('boots to Active in the exact machine order, serves health, drains in reverse', async () => {
    const relay = manualPacer();
    const sink = new MemoryLogSink();
    const started = await startServerRuntime(testSources(), {
      relayPacer: relay.pacer,
      logSink: sink,
    });
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }
    const graph = started.value;
    try {
      expect(graph.container.state).toBe('Active');
      const port = graph.http.portInUse;
      expect(port).toBeGreaterThan(0);

      // ---- the three runtime surfaces (R-6), over real HTTP.
      const live = await fetch(`http://127.0.0.1:${String(port)}/live`);
      expect(live.status).toBe(200);
      const ready = await fetch(`http://127.0.0.1:${String(port)}/ready`);
      expect(ready.status).toBe(200);
      const health = await fetch(`http://127.0.0.1:${String(port)}/health`);
      expect(health.status).toBe(200);
      const body = (await health.json()) as { liveness: { overall: { kind: string } } };
      expect(body.liveness.overall.kind).toBe('healthy');
      const nothing = await fetch(`http://127.0.0.1:${String(port)}/anything`);
      expect(nothing.status).toBe(404);
      const posted = await fetch(`http://127.0.0.1:${String(port)}/live`, { method: 'POST' });
      expect(posted.status).toBe(404);
    } finally {
      await shutdownServer(graph);
    }
    expect(graph.container.state).toBe('Destroyed');
    expect(relay.stops()).toBeGreaterThanOrEqual(1);
    // After drainage the surface is closed.
    await expect(fetch(`http://127.0.0.1:${String(graph.http.portInUse ?? 0)}/live`)).rejects.toThrow();
  }, 30_000);

  it('THE LOOP CLOSES: command → dispatch → retention → relay tick → carried', async () => {
    const relay = manualPacer();
    const sink = new MemoryLogSink();
    const started = await startServerRuntime(testSources(), {
      relayPacer: relay.pacer,
      logSink: sink,
    });
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }
    const graph = started.value;
    try {
      await graph.prisma.$executeRawUnsafe(
        'TRUNCATE "AgreementSnapshot", "AgreementFact", "AgreementOutbox", "AgreementInbox"',
      );
      const now = Date.now();
      const outcome = await graph.assembly.commandDispatch.dispatch({
        payload: {
          type: 'RequestAgreement',
          contractVersion: 1,
          commandId: 'cmd-e2e-1',
          agreementId: 'agr-e2e',
          clientId: 'cli-1',
          expertId: 'exp-1',
          offerId: 'off-1',
          slot: { startMs: now + 10 * 3_600_000, endMs: now + 11 * 3_600_000 },
          availabilityWindows: [{ startMs: now, endMs: now + 100 * 3_600_000 }],
        },
        actor: 'client-actor' as never,
        correlationId: 'corr-e2e' as never,
      });
      expect(outcome.kind).toBe('executed');
      // Retained: photo + fact + pending outbox row, one atomic act (A-3).
      expect(await graph.prisma.agreementSnapshot.count()).toBe(1);
      expect(await graph.prisma.agreementFact.count()).toBe(1);
      const pendingBefore = await graph.prisma.agreementOutbox.findFirst();
      expect(pendingBefore?.status).toBe('pending');
      // One relay tick: claimed, carried to the (empty) routing, published.
      await relay.tick();
      const carried = await graph.prisma.agreementOutbox.findFirst();
      expect(carried?.status).toBe('published');
      // The query side answers over the same living graph.
      const answered = await graph.assembly.queryDispatch.dispatch({
        payload: { type: 'AgreementStateQuery', contractVersion: 1, agreementId: 'agr-e2e' },
        actor: 'cli-1' as never,
        correlationId: 'corr-e2e-q' as never,
      });
      expect(answered.kind).toBe('answered');
    } finally {
      await shutdownServer(graph);
    }
  }, 30_000);

  it('signals: SIGINT and SIGTERM both take the drainage road, once', async () => {
    const relay = manualPacer();
    const started = await startServerRuntime(testSources(), {
      relayPacer: relay.pacer,
      logSink: new MemoryLogSink(),
    });
    expect(started.ok).toBe(true);
    if (!started.ok) {
      return;
    }
    const handlers = new Map<string, () => void>();
    const exits: number[] = [];
    const host: SignalHost = {
      on: (signal, handler) => handlers.set(signal, handler),
      exit: (code) => {
        exits.push(code);
      },
    };
    let downs = 0;
    wireSignals(started.value, host, () => {
      downs += 1;
    });
    expect([...handlers.keys()].sort()).toEqual(['SIGINT', 'SIGTERM']);
    handlers.get('SIGTERM')?.();
    handlers.get('SIGINT')?.(); // second signal: already closing — ignored.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(started.value.container.state).toBe('Destroyed');
    expect(downs).toBe(1);
    expect(exits).toEqual([0]);
  }, 30_000);
});

describe('boot refusals (fail closed — nothing serves)', () => {
  it('an unreachable engine kills the boot with its proof named; nothing listens', async () => {
    const relay = manualPacer();
    const started = await startServerRuntime(
      [
        inMemorySource('spec', {
          MENTORA_AGREEMENT_DATABASE_URL: 'postgresql://mentora:wrong@127.0.0.1:59999/void',
          MENTORA_IDENTITY_DATABASE_URL: 'postgresql://mentora:wrong@127.0.0.1:59999/void',
          MENTORA_ACCOUNT_DATABASE_URL: 'postgresql://mentora:wrong@127.0.0.1:59999/void',
          MENTORA_HTTP_PORT: '0',
          MENTORA_LOG_THRESHOLD: 'error',
        }),
      ],
      { relayPacer: relay.pacer, logSink: new MemoryLogSink() },
    );
    expect(started.ok).toBe(false);
    if (!started.ok) {
      expect(started.error.kind).toBe('validation');
      if (started.error.kind === 'validation') {
        expect(started.error.failures[0]).toContain('boot-construction');
        expect(started.error.failures.join('\n')).toContain('database server');
        expect(renderBootReport(started.error)).toContain('BOOT REFUSED');
      }
    }
  }, 30_000);
});

describe('dotEnvSource (the tiny lawful .env reader)', () => {
  it('parses KEY=VALUE lines, ignoring comments, blanks and equals-free lines', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mentora-dotenv-'));
    const path = join(dir, '.env');
    try {
      writeFileSync(path, '# a comment\n\nFOO=bar\nSPACED = with = equals \nNOEQUALS\n', 'utf8');
      const source = dotEnvSource(path);
      expect(source.read('FOO')).toBe('bar');
      expect(source.read('SPACED')).toBe('with = equals');
      expect(source.read('NOEQUALS')).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('the Root builds the graph without serving (composition alone)', () => {
  const deadSources = [
    inMemorySource('dead', {
      MENTORA_AGREEMENT_DATABASE_URL: 'postgresql://mentora:wrong@127.0.0.1:59999/void',
          MENTORA_IDENTITY_DATABASE_URL: 'postgresql://mentora:wrong@127.0.0.1:59999/void',
          MENTORA_ACCOUNT_DATABASE_URL: 'postgresql://mentora:wrong@127.0.0.1:59999/void',
    }),
  ];

  it('composes with pure defaults (console well, system clock, empty routing, real pacer)', async () => {
    const graph = buildServerGraph(deadSources);
    expect(graph.ok).toBe(true);
    if (graph.ok) {
      expect(graph.value.container.state).toBe('Construction');
      expect(graph.value.http.portInUse).toBeUndefined();
      await graph.value.prisma.$disconnect();
    }
  });

  it('composes with every override honored', async () => {
    const graph = buildServerGraph(deadSources, {
      clock: new SystemClock(),
      logSink: new MemoryLogSink(),
      publisher: { publish: () => Promise.resolve() },
      relayPacer: () => () => undefined,
      httpPort: 0,
    });
    expect(graph.ok).toBe(true);
    if (graph.ok) {
      await graph.value.prisma.$disconnect();
    }
  });

  it('the database-reachable proof fails closed with the engine error named', async () => {
    const graph = buildServerGraph(deadSources, { logSink: new MemoryLogSink() });
    expect(graph.ok).toBe(true);
    if (!graph.ok) {
      return;
    }
    const validator = graph.value.container.assembly.validators.find(
      (candidate) => candidate.name === 'database-reachable',
    );
    expect(validator).toBeDefined();
    const proof = await validator?.validate();
    expect(proof?.ok).toBe(false);
    await graph.value.prisma.$disconnect();
  }, 30_000);

  it('an unreachable engine turns readiness unhealthy — through the declared checks', async () => {
    const graph = buildServerGraph(deadSources, { logSink: new MemoryLogSink() });
    expect(graph.ok).toBe(true);
    if (!graph.ok) {
      return;
    }
    const readiness = await graph.value.health.report('readiness');
    expect(readiness.overall.kind).toBe('unhealthy');
    const liveness = await graph.value.health.report('liveness');
    expect(liveness.overall.kind).toBe('healthy');
    await graph.value.prisma.$disconnect();
  }, 30_000);
});

describe('bootServer converts machinery throws into REPORTED refusals', () => {
  it('a non-Error throw is stringified; a failing engine release never masks the report', async () => {
    const stub = {
      container: {
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- proving the non-Error throw branch
        boot: () => Promise.reject('engine exploded as a bare string'),
      },
      prisma: { $disconnect: () => Promise.reject(new Error('release also failing')) },
    } as unknown as ServerGraph;
    const out = await bootServer(stub);
    expect(out.ok).toBe(false);
    if (!out.ok && out.error.kind === 'validation') {
      expect(out.error.failures[0]).toContain('boot-construction');
      expect(out.error.failures[0]).toContain('engine exploded as a bare string');
    }
  });
});

describe('the process wire (runServerProcess)', () => {
  const hostOf = (): {
    host: ProcessHost;
    handlers: Map<string, () => void>;
    exits: number[];
    stderr: string[];
  } => {
    const handlers = new Map<string, () => void>();
    const exits: number[] = [];
    const stderr: string[] = [];
    return {
      host: {
        on: (signal, handler) => handlers.set(signal, handler),
        exit: (code) => {
          exits.push(code);
        },
        stderrLine: (line) => {
          stderr.push(line);
        },
      },
      handlers,
      exits,
      stderr,
    };
  };

  it('with the DEFAULT sources (.env + environment): a blank URL refuses, reports, exits 1', async () => {
    vi.stubEnv('MENTORA_AGREEMENT_DATABASE_URL', '   ');
    const { host, exits, stderr } = hostOf();
    await runServerProcess(host);
    expect(exits).toEqual([1]);
    expect(stderr.join('\n')).toContain('BOOT REFUSED');
  });

  it.skipIf(url === undefined)(
    'runs the whole road: boot → ACTIVE → SIGTERM → drained → exit 0',
    async () => {
      const relay = manualPacer();
      const { host, handlers, exits } = hostOf();
      await runServerProcess(host, testSources(), {
        relayPacer: relay.pacer,
        logSink: new MemoryLogSink(),
      });
      expect(exits).toEqual([]);
      handlers.get('SIGTERM')?.();
      await vi.waitFor(() => {
        expect(exits).toEqual([0]);
      });
    },
    30_000,
  );
});

describe('the Application surface alone (HttpServerModule units)', () => {
  const logger = createLoggerFactory({
    clock: new SystemClock(),
    sink: new MemoryLogSink(),
    threshold: 'error',
  }).loggerFor('spec');

  it('starting before constructing violates the I-11 order', async () => {
    const module = new HttpServerModule(0, new HealthRegistry(), logger);
    await expect(module.start()).rejects.toThrow('constructed before starting');
  });

  it('draining an unconstructed surface is a lawful no-op', async () => {
    await expect(
      new HttpServerModule(0, new HealthRegistry(), logger).drain(),
    ).resolves.toBeUndefined();
  });

  it('an unhealthy readiness renders 503 on /ready and /health — fail closed', async () => {
    const registry = new HealthRegistry();
    registry.register({
      name: 'doomed',
      kind: 'readiness',
      check: () => Promise.resolve(unhealthy('the proof is down')),
    });
    registry.register({ name: 'alive', kind: 'liveness', check: () => Promise.resolve(healthy()) });
    const module = new HttpServerModule(0, registry, logger);
    module.construct();
    await module.start();
    try {
      const port = module.portInUse;
      expect(port).toBeDefined();
      const ready = await fetch(`http://127.0.0.1:${String(port)}/ready`);
      expect(ready.status).toBe(503);
      const health = await fetch(`http://127.0.0.1:${String(port)}/health`);
      expect(health.status).toBe(503);
    } finally {
      await module.drain();
      module.dispose();
    }
    expect(module.portInUse).toBeUndefined();
  });
});

describe('the empty routing (M-5: zero declared subscribers IS complete delivery)', () => {
  it('witnesses each carried envelope — correlation carried only when it exists', async () => {
    const sink = new MemoryLogSink();
    const publisher = new EmptyRoutingPublisher(
      createLoggerFactory({ clock: new SystemClock(), sink, threshold: 'info' }).loggerFor('relay'),
    );
    const base = {
      messageId: 'msg-1',
      subjectKey: 'agr-1',
      sequence: 1,
      payload: '{}',
      occurredAtMs: 1,
      deliveryAttempts: 0,
    };
    await publisher.publish(base);
    await publisher.publish({ ...base, messageId: 'msg-2', correlationId: 'corr-1' });
    expect(sink.lines).toHaveLength(2);
    expect(sink.lines[0]).not.toContain('correlationId');
    expect(sink.lines[1]).toContain('corr-1');
  });
});

describe('shutdown wiring defends the exit code', () => {
  it('a shutdown that throws exits 1 — the death is still announced, never hidden', async () => {
    const stub = {
      container: { shutdown: () => Promise.reject(new Error('drain exploded')) },
      loggers: createLoggerFactory({
        clock: new SystemClock(),
        sink: new MemoryLogSink(),
        threshold: 'error',
      }),
    } as unknown as ServerGraph;
    const handlers = new Map<string, () => void>();
    const exits: number[] = [];
    wireSignals(stub, {
      on: (signal, handler) => handlers.set(signal, handler),
      exit: (code) => {
        exits.push(code);
      },
    });
    handlers.get('SIGINT')?.();
    await vi.waitFor(() => {
      expect(exits).toEqual([1]);
    });
  });
});

afterAll(() => {
  // The spec never leaves a listener behind; sockets die with the graphs above.
});
