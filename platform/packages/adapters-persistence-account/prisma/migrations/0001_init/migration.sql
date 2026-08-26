-- 0001_init — the Account registries (Canonical Persistence Model, RC-1;
-- reference: adapters-persistence-identity 0001). Hand-authored expand
-- migration (S-7), executed by the Migration species, never by a boot.
--
-- Four photographs; ONE context-wide fact/outbox/inbox keyed by unit
-- subject (justified divergence — three publishing units, one relay);
-- NO SupportRequest fact/outbox/inbox tables (state-only by ABSENCE —
-- precedent: Session); the choreography store (RFC-003 P3/P4).

CREATE TABLE "AccountSnapshot" (
    "personId"          TEXT NOT NULL,
    "version"           INTEGER NOT NULL,
    "payload"           TEXT NOT NULL,
    "checksum"          TEXT NOT NULL,
    "stateKind"         TEXT NOT NULL,
    "verificationState" TEXT NOT NULL,
    "reachability"      TEXT,

    CONSTRAINT "AccountSnapshot_pkey" PRIMARY KEY ("personId")
);
CREATE INDEX "AccountSnapshot_stateKind_idx" ON "AccountSnapshot"("stateKind");

CREATE TABLE "AvailabilityFrameSnapshot" (
    "personId" TEXT NOT NULL,
    "version"  INTEGER NOT NULL,
    "payload"  TEXT NOT NULL,
    "checksum" TEXT NOT NULL,

    CONSTRAINT "AvailabilityFrameSnapshot_pkey" PRIMARY KEY ("personId")
);

CREATE TABLE "SubscriptionSnapshot" (
    "subscriptionId" TEXT NOT NULL,
    "version"        INTEGER NOT NULL,
    "payload"        TEXT NOT NULL,
    "checksum"       TEXT NOT NULL,
    "personId"       TEXT NOT NULL,
    "stateKind"      TEXT NOT NULL,

    CONSTRAINT "SubscriptionSnapshot_pkey" PRIMARY KEY ("subscriptionId")
);
CREATE INDEX "SubscriptionSnapshot_personId_stateKind_idx"
    ON "SubscriptionSnapshot"("personId", "stateKind");

-- THE DECLARED R-A KEY (F3.2-B: « une souscription active à la fois »),
-- applied STRUCTURALLY by the registry: a PARTIAL UNIQUE INDEX — one ACTIVE
-- subscription per holder. The rule lives in the domain
-- (ActiveSubscriptionUniquenessSpecification); this index is its declared
-- key; the violation is refused as SubscriptionAlreadyExists — never an
-- exception, never a lock (F5.1 §19).
CREATE UNIQUE INDEX "subscription_active_holder_ra_key"
    ON "SubscriptionSnapshot"("personId")
    WHERE "stateKind" = 'Active';

CREATE TABLE "SupportRequestSnapshot" (
    "supportRequestId" TEXT NOT NULL,
    "version"          INTEGER NOT NULL,
    "payload"          TEXT NOT NULL,
    "checksum"         TEXT NOT NULL,
    "stateKind"        TEXT NOT NULL,

    CONSTRAINT "SupportRequestSnapshot_pkey" PRIMARY KEY ("supportRequestId")
);

CREATE TABLE "AccountFact" (
    "subjectKey"      TEXT NOT NULL,
    "sequence"        INTEGER NOT NULL,
    "type"            TEXT NOT NULL,
    "payload"         TEXT NOT NULL,
    "contractVersion" INTEGER NOT NULL,
    "occurredAtMs"    BIGINT NOT NULL,
    "checksum"        TEXT NOT NULL,

    CONSTRAINT "AccountFact_pkey" PRIMARY KEY ("subjectKey", "sequence")
);

CREATE TABLE "AccountOutbox" (
    "id"               BIGSERIAL NOT NULL,
    "messageId"        TEXT NOT NULL,
    "subjectKey"       TEXT NOT NULL,
    "sequence"         INTEGER NOT NULL,
    "correlationId"    TEXT,
    "causationId"      TEXT,
    "deliveryAttempts" INTEGER NOT NULL DEFAULT 0,
    "payload"          TEXT NOT NULL,
    "occurredAtMs"     BIGINT NOT NULL,
    "status"           TEXT NOT NULL DEFAULT 'pending',
    "claimedUntilMs"   BIGINT NOT NULL DEFAULT 0,
    "nextAttemptAtMs"  BIGINT NOT NULL DEFAULT 0,
    "quarantineReason" TEXT,

    CONSTRAINT "AccountOutbox_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AccountOutbox_messageId_key" ON "AccountOutbox"("messageId");
CREATE UNIQUE INDEX "AccountOutbox_subjectKey_sequence_key"
    ON "AccountOutbox"("subjectKey", "sequence");
CREATE INDEX "AccountOutbox_status_id_idx" ON "AccountOutbox"("status", "id");

CREATE TABLE "AccountInbox" (
    "consumer"      TEXT NOT NULL,
    "subjectKey"    TEXT NOT NULL,
    "sequence"      INTEGER NOT NULL,
    "processedAtMs" BIGINT NOT NULL,

    CONSTRAINT "AccountInbox_pkey" PRIMARY KEY ("consumer", "subjectKey", "sequence")
);

-- The DECLARED choreography's store (RFC-003 P3/P4): the journey's Inbox,
-- its position (the only memory — the pardon test) and its Outbox de
-- commandes (drained by the composition's declared handler).
CREATE TABLE "ChoreographyInbox" (
    "factIdentity" TEXT NOT NULL,
    "retainedAtMs" BIGINT NOT NULL,

    CONSTRAINT "ChoreographyInbox_pkey" PRIMARY KEY ("factIdentity")
);

CREATE TABLE "ChoreographyPosition" (
    "journeyKey" TEXT NOT NULL,
    "payload"    TEXT NOT NULL,
    "checksum"   TEXT NOT NULL,

    CONSTRAINT "ChoreographyPosition_pkey" PRIMARY KEY ("journeyKey")
);

CREATE TABLE "ChoreographyCommand" (
    "id"        BIGSERIAL NOT NULL,
    "commandId" TEXT NOT NULL,
    "payload"   TEXT NOT NULL,

    CONSTRAINT "ChoreographyCommand_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ChoreographyCommand_commandId_key" ON "ChoreographyCommand"("commandId");
