# @mentora/adapters-persistence-account

The PostgreSQL/Prisma adapter of the Account registries (Lot A04) — **reference: `adapters-persistence-identity`, copied exactly**, with three divergences justified under Domain Checklist §I (all documented in `prisma/schema.prisma` and the concurrency guard):

1. **One context-wide fact-stream/outbox/inbox** (`AccountFact`/`AccountOutbox`/`AccountInbox`) keyed by `subjectKey` — three units publish here where Identity had one; per-subject order (F4.3 §4) is the `(subjectKey, sequence)` key either way.
2. **The version law**: +1 per act, fact or not — expected previous version = `version − unretainedActs` (the units carry the delta), never `− pendingFacts.length`.
3. **The choreography store tables** (RFC-003 P3/P4): journey Inbox, position, Outbox de commandes — Identity has no ratified reaction; Account's is canon.

The R-A key « une souscription active par titulaire » is the **partial unique index** `subscription_active_holder_ra_key` (`WHERE stateKind = 'Active'` on `personId`), applied at retention and classified as `SubscriptionAlreadyExists` after rollback. **SupportRequest is state-only by ABSENCE of tables** (precedent: Session — the absence is the proof). Migrations are hand-authored SQL, deployed by the gate (`prisma migrate deploy`), never by a boot; datasource `MENTORA_ACCOUNT_DATABASE_URL` (CI: third database on the same server). Generated client in `src/generated` (vendor floor).

PR-2 adds: repository facades, read adapters of the two ratified lectures, `PrismaAccountRelaySource`, `PrismaChoreographyStore`, the integration replay of the **four contract suites** (the acceptance criterion) and the server Root wiring.
