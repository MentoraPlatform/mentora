import { environmentSource, inMemorySource } from '@mentora/runtime-config';
import { MemoryLogSink } from '@mentora/runtime-logging';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { ServerGraph } from './composition/server-composition.js';
import { startServerRuntime } from './runtime/server-runtime.js';
import { shutdownServer } from './shutdown/server-shutdown.js';

/**
 * THE GATEWAY GATE (Stories #79-#95 + the Sprint 4 mechanisms #96-#114) —
 * real HTTP on an ephemeral port, real PostgreSQL registries, the WHOLE
 * road: presented MATERIAL → vault demonstration → policy judgment →
 * session → authenticated command → correlation in the Outbox de faits.
 *
 * Since Story #96 the entry takes material and MINTS the strength: the
 * trust-the-client seam of the Sprint 3 interim is dead (#99). The
 * credential is established through the ASSEMBLY service and its material
 * sealed at the vault — the spec stands in for the Account ACL (canon:
 * "Credential établi par l'ACL du Compte"; A05 will own both acts).
 */

const url = environmentSource().read('MENTORA_AGREEMENT_DATABASE_URL');
const identityUrl = environmentSource().read('MENTORA_IDENTITY_DATABASE_URL');
const accountUrl = environmentSource().read('MENTORA_ACCOUNT_DATABASE_URL');
const ready = url !== undefined && identityUrl !== undefined;

const specSources = (extra: Record<string, string> = {}) => [
  inMemorySource('gateway-spec', {
    MENTORA_AGREEMENT_DATABASE_URL: url ?? 'postgresql://void',
    MENTORA_IDENTITY_DATABASE_URL: identityUrl ?? 'postgresql://void',
    MENTORA_ACCOUNT_DATABASE_URL: accountUrl ?? 'postgresql://void',
    MENTORA_HTTP_PORT: '0',
    MENTORA_LOG_THRESHOLD: 'error',
    MENTORA_RELAY_INTERVAL_MILLIS: '3600000', // the spec never ticks the relay.
    ...extra,
  }),
];

const PERSON = 'person-e2e';
const PASSWORD = 'correct horse battery staple';
const PIN = '724流631';

interface Harness {
  graph: ServerGraph;
  base: string;
}

const boot = async (extra: Record<string, string> = {}): Promise<Harness> => {
  const started = await startServerRuntime(specSources(extra), { logSink: new MemoryLogSink() });
  if (!started.ok) throw new Error('boot refused');
  return {
    graph: started.value,
    base: `http://127.0.0.1:${String(started.value.http.portInUse ?? 0)}`,
  };
};

const truncate = async (graph: ServerGraph): Promise<void> => {
  await graph.prisma.$executeRawUnsafe(
    'TRUNCATE "AgreementSnapshot", "AgreementFact", "AgreementOutbox", "AgreementInbox"',
  );
  await graph.identityPrisma.$executeRawUnsafe(
    'TRUNCATE "CredentialSnapshot", "CredentialFact", "CredentialOutbox", "CredentialInbox", "SessionSnapshot", "ProofMaterial"',
  );
};

const posting =
  (base: string) =>
  (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(base + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });

/**
 * The ACL stand-in (A05 will own this): establishes the credential AND
 * seals its material at the vault — two acts the future Account ACL
 * performs on RegisterPerson.
 */
const establishWithMaterial = async (
  graph: ServerGraph,
  options: {
    id?: string;
    person?: string;
    strength?: string;
    material?: string;
    secondary?: { strength: string; material: string };
  } = {},
): Promise<void> => {
  const id = options.id ?? 'cred-e2e';
  const outcome = await graph.identity.services.establishCredential.execute({
    payload: {
      type: 'EstablishCredential',
      contractVersion: 1,
      commandId: `cmd-est-${id}`,
      credentialId: id,
      personId: options.person ?? PERSON,
      principalFactor: {
        factorId: `factor-${id}`,
        kind: 'password',
        strength: options.strength ?? 'standard',
      },
      ...(options.secondary === undefined
        ? {}
        : {
            secondaryFactors: [
              { factorId: `factor-${id}-2`, kind: 'password', strength: options.secondary.strength },
            ],
          }),
    },
    actor: 'account-acl' as never,
    correlationId: 'corr-acl' as never,
  });
  if (outcome.kind !== 'executed') throw new Error(`ACL stand-in failed: ${outcome.kind}`);
  await graph.proofVault.store(`factor-${id}`, 'password', options.material ?? PASSWORD);
  if (options.secondary !== undefined) {
    await graph.proofVault.store(`factor-${id}-2`, 'password', options.secondary.material);
  }
};

describe.skipIf(!ready)('the Gateway M-10 with real proof mechanisms', () => {
  let graph: ServerGraph;
  let post: ReturnType<typeof posting>;

  beforeAll(async () => {
    const harness = await boot();
    graph = harness.graph;
    post = posting(harness.base);
  }, 30_000);

  beforeEach(async () => {
    await truncate(graph);
  });

  afterAll(async () => {
    await shutdownServer(graph);
  }, 30_000);

  const openSession = (
    id = 'sess-e2e',
    credential = 'cred-e2e',
    proofs: readonly { factorId: string; material: string }[] = [
      { factorId: `factor-${credential}`, material: PASSWORD },
    ],
  ) =>
    post('/entry/open-session', {
      commandId: `cmd-open-${id}`,
      sessionId: id,
      credentialId: credential,
      proofs,
    });

  it('the entry demonstrates the material and opens — the digest is scrypt, the matter appears NOWHERE', async () => {
    await establishWithMaterial(graph);
    const opened = await openSession();
    expect(opened.status).toBe(200);
    expect(((await opened.json()) as { kind: string }).kind).toBe('executed');

    // "hash sous coffre" (#96): one place, one-way, self-describing format.
    const vaultRow = await graph.identityPrisma.proofMaterial.findUnique({
      where: { factorId: 'factor-cred-e2e' },
    });
    expect(vaultRow?.digest.startsWith('scrypt$')).toBe(true);
    expect(vaultRow?.digest.includes(PASSWORD)).toBe(false);

    // Zero matter beyond the vault (#99): facts, photos, outbox — clean.
    const [facts, snapshots, outbox] = await Promise.all([
      graph.identityPrisma.credentialFact.findMany(),
      graph.identityPrisma.credentialSnapshot.findMany(),
      graph.identityPrisma.credentialOutbox.findMany(),
    ]);
    const text = (value: unknown): string =>
      JSON.stringify(value, (_, field: unknown) =>
        typeof field === 'bigint' ? field.toString() : field,
      );
    for (const row of [...facts, ...snapshots, ...outbox]) {
      expect(text(row).includes(PASSWORD)).toBe(false);
    }
  });

  it('adversarial (#99): wrong material, unknown factor, empty proofs — ONE flat 401, nothing enumerable', async () => {
    await establishWithMaterial(graph);
    const wrong = await openSession('sess-w', 'cred-e2e', [
      { factorId: 'factor-cred-e2e', material: 'wrong password' },
    ]);
    const unknownFactor = await openSession('sess-u', 'cred-e2e', [
      { factorId: 'factor-ghost', material: PASSWORD },
    ]);
    const ghostCredential = await openSession('sess-g', 'cred-ghost', [
      { factorId: 'factor-cred-ghost', material: PASSWORD },
    ]);
    const empty = await openSession('sess-n', 'cred-e2e', []);
    for (const rejected of [wrong, unknownFactor, ghostCredential, empty]) {
      expect(rejected.status).toBe(401);
      expect(((await rejected.json()) as { detail: string }).detail).toBe('proof rejected');
    }
  });

  it('adversarial (#99): a caller-declared presentedStrength is a CLOSED DOOR — the seam is dead', async () => {
    await establishWithMaterial(graph);
    const injected = await post('/entry/open-session', {
      commandId: 'cmd-inject',
      sessionId: 'sess-inject',
      credentialId: 'cred-e2e',
      presentedStrength: 'elevated',
      proofs: [{ factorId: 'factor-cred-e2e', material: PASSWORD }],
    });
    expect(injected.status).toBe(404);
    // The old Sprint 3 wire shape (declared strength, no material) is equally dead.
    const oldWire = await post('/entry/open-session', {
      type: 'OpenSession',
      contractVersion: 1,
      commandId: 'cmd-old',
      sessionId: 'sess-old',
      credentialId: 'cred-e2e',
      presentedStrength: 'standard',
    });
    expect(oldWire.status).toBe(404);
  });

  it('a factor whose RATIFIED strength the product refuses: material verifies, the POLICY refuses — 409, motivated', async () => {
    await establishWithMaterial(graph, { id: 'cred-weak', strength: 'whisper' });
    const weak = await openSession('sess-weak', 'cred-weak', [
      { factorId: 'factor-cred-weak', material: PASSWORD },
    ]);
    expect(weak.status).toBe(409);
    const refusal = (await weak.json()) as { refusal: { reason: string } };
    expect(refusal.refusal.reason).toBe('ProofUnavailable');
  });

  it('THE WHOLE ROAD still closes: proven login → authenticated Agreement command → correlation in the Outbox de faits', async () => {
    await establishWithMaterial(graph);
    await openSession();
    const now = Date.now();
    const commanded = await post(
      '/commands',
      {
        type: 'RequestAgreement',
        contractVersion: 1,
        commandId: 'cmd-agr-e2e',
        agreementId: 'agr-e2e',
        clientId: PERSON,
        expertId: 'exp-1',
        offerId: 'off-1',
        slot: { startMs: now + 10 * 3_600_000, endMs: now + 11 * 3_600_000 },
        availabilityWindows: [{ startMs: now, endMs: now + 100 * 3_600_000 }],
      },
      { 'x-mentora-session': 'sess-e2e', 'x-mentora-correlation': 'corr-road-1' },
    );
    expect(commanded.status).toBe(200);
    expect(commanded.headers.get('x-mentora-correlation')).toBe('corr-road-1');
    const outboxRow = await graph.prisma.agreementOutbox.findFirst();
    expect(outboxRow?.correlationId).toBe('corr-road-1');
    expect(outboxRow?.causationId).toBe('cmd-agr-e2e');
  });

  it('RECOVERY (#104-#107): a NEW credential is established, the old one revoked and disowned — nothing is ever "recovered"', async () => {
    // The person lives with credential A and a session.
    await establishWithMaterial(graph, { id: 'cred-a' });
    const opened = await openSession('sess-a', 'cred-a');
    expect(opened.status).toBe(200);

    // The R-A key FORCES the recovery order: while cred-a is ACTIVE, a
    // second credential for the same (person × principal-factor kind) is
    // structurally REFUSED — establish-before-revoke cannot exist.
    await expect(
      establishWithMaterial(graph, { id: 'cred-b', material: 'a brand new secret' }),
    ).rejects.toThrow('refused');

    // The ACL stand-in therefore revokes FIRST (R-B: re-entering is a new
    // unit), DISOWNS the old factor names at the vault (#106: the old
    // proof is never handed back; scrypt could not reveal it anyway),
    // then establishes the NEW credential with NEW names and NEW material.
    const revoked = await graph.identity.services.revokeCredential.execute({
      payload: {
        type: 'RevokeCredential',
        contractVersion: 1,
        commandId: 'cmd-rev-a',
        credentialId: 'cred-a',
        motive: 'recovery',
      },
      actor: 'account-acl' as never,
      correlationId: 'corr-recovery' as never,
    });
    expect(revoked.kind).toBe('executed');
    await graph.proofVault.disown(['factor-cred-a']);
    await establishWithMaterial(graph, { id: 'cred-b', material: 'a brand new secret' });

    // The old session is dead AT THE GATE (chain broken at its root).
    const barred = await post('/commands', { type: 'RequestAgreement' }, { 'x-mentora-session': 'sess-a' });
    expect(barred.status).toBe(401);
    // The old credential + its old (correct!) material open NOTHING.
    const replay = await openSession('sess-a2', 'cred-a', [
      { factorId: 'factor-cred-a', material: PASSWORD },
    ]);
    expect(replay.status).toBe(401);
    // The person enters through the NEW proof.
    const fresh = await openSession('sess-b', 'cred-b', [
      { factorId: 'factor-cred-b', material: 'a brand new secret' },
    ]);
    expect(fresh.status).toBe(200);
    // And the vault holds NO row for the disowned factor name.
    expect(
      await graph.identityPrisma.proofMaterial.findUnique({ where: { factorId: 'factor-cred-a' } }),
    ).toBeNull();
  });
});

describe.skipIf(!ready)('MFA (#111-#114): the product requires ELEVATED — one factor is not enough', () => {
  let graph: ServerGraph;
  let post: ReturnType<typeof posting>;

  beforeAll(async () => {
    // acceptedStrengths = elevated ONLY; standard+standard composes to elevated.
    const harness = await boot({ MENTORA_PRODUCT_PROOF_ACCEPTED_STRENGTHS: 'elevated' });
    graph = harness.graph;
    post = posting(harness.base);
    await truncate(graph);
    await establishWithMaterial(graph, {
      id: 'cred-mfa',
      strength: 'standard',
      secondary: { strength: 'standard', material: PIN },
    });
  }, 30_000);

  afterAll(async () => {
    await shutdownServer(graph);
  }, 30_000);

  it('one verified factor presents its own strength — refused by the requirement (409, motivated)', async () => {
    const single = await post('/entry/open-session', {
      commandId: 'cmd-mfa-1',
      sessionId: 'sess-mfa-1',
      credentialId: 'cred-mfa',
      proofs: [{ factorId: 'factor-cred-mfa', material: PASSWORD }],
    });
    expect(single.status).toBe(409);
    expect(((await single.json()) as { refusal: { reason: string } }).refusal.reason).toBe(
      'ProofUnavailable',
    );
  });

  it('two verified factors COMPOSE through the declared product table — the session opens', async () => {
    const both = await post('/entry/open-session', {
      commandId: 'cmd-mfa-2',
      sessionId: 'sess-mfa-2',
      credentialId: 'cred-mfa',
      proofs: [
        { factorId: 'factor-cred-mfa', material: PASSWORD },
        { factorId: 'factor-cred-mfa-2', material: PIN },
      ],
    });
    expect(both.status).toBe(200);
    expect(((await both.json()) as { kind: string }).kind).toBe('executed');
  });

  it('one factor RIGHT and one WRONG is the same flat rejection — composition never reveals which', async () => {
    const mixed = await post('/entry/open-session', {
      commandId: 'cmd-mfa-3',
      sessionId: 'sess-mfa-3',
      credentialId: 'cred-mfa',
      proofs: [
        { factorId: 'factor-cred-mfa', material: PASSWORD },
        { factorId: 'factor-cred-mfa-2', material: 'wrong pin' },
      ],
    });
    expect(mixed.status).toBe(401);
    expect(((await mixed.json()) as { detail: string }).detail).toBe('proof rejected');
  });
});
