# New Domain Bootstrap Guide — copier Identity, exactement

**Statut** : standard officiel (CTO, 2026-08-19) · Pour ouvrir un domaine ratifié du Corpus (ex. Account, Enterprise, Consent…) en copiant le domaine de référence. Zéro invention : tout ce qui n'est pas dans ce guide et dans le handbook est une question Titre VII, pas une initiative.

## Étape 0 — Lire avant d'écrire (1 jour)
1. Le chapitre d'agrégats du domaine (`docs/canon/source/domain/0x-*.md`) et les catalogues : unités (§05), commandes (§02), faits (§01), policies (§04), specifications, machines d'états (§08), **lectures ratifiées** (§03 — s'il n'y en a pas, la table de Query sera fermée et vide).
2. Le dictionnaire bilingue (ch. 04) pour **chaque** nom ; lister les trous de vocabulaire à enregistrer.
3. Le [handbook de référence](identity-reference-handbook.md), la [Domain Checklist](domain-checklist.md), la [DoD](definition-of-done.md).
4. Les RFC/ADR ratifiées qui touchent le domaine (RFC-001 corrélation, RFC-002 droits d'émission, ADR-0004 fédération…).

## Étape 1 — Gouvernance (½ jour)
- Epic (`EPIC-00n <Domaine>`, type Epic) ; Features par unité/couche comme EPIC-001 ; Stories + Tasks avec critères d'acceptation **citant les lois** ; dépendances ; ajout au Project ; champs remplis.
- CODEOWNERS : les nouveaux chemins aux équipes `backend` + `security` (et `platform` pour `adapters-*`).
- Variables déclarées : `MENTORA_<DOMAINE>_DATABASE_URL` dans `ci.yml`, `nightly.yml`, `release.yml` (service PostgreSQL + `prisma migrate deploy` du nouveau paquet) ; base de test dédiée.

## Étape 2 — `contracts-<domaine>` (Sprint 1, lot 1)
Copier `contracts-identity` : `identifiers.ts` (ids brandés + `xOf`), `refusals.ts` (unions de raisons — uniquement des familles ratifiées ou dérivées documentées), `commands/<domaine>-command-contracts.ts` (wires `contractVersion: 1`, `type`, `commandId`, union + `<DOMAINE>_COMMAND_TYPES`), `validation/` (par type, toutes les violations), `events/` + sérialiseur déterministe si le domaine publie des faits. Tests de forme. Sous-chemins d'export si un module importe vitest.

## Étape 3 — `domain-<domaine>` (Sprint 1, un lot par unité)
Copier la structure : `aggregate/`, `entities/`, `value-objects/`, `events/` (`<Truth><PastParticiple>`) + union dans `aggregate/`, `commands/`, `decisions/` (refus), `factories/`, `policies/`, `specifications/`, `ports/`, `snapshots/`, `errors/`, `testing/` (référence mémoire pure + contract suite sur sous-chemin). Tests : lifecycle, invariants, snapshot roundtrip/corruption, surface de clés, contract suite sur mémoire.

## Étape 4 — `application-<domaine>` (Sprint 1-2)
Copier `application-identity` : `definitions/` (une par unité), `factories/` (seams), `services/` (un porteur par commande), `read/ports/` (capacités) et `query/` seulement pour les Queries **ratifiées**, `composition/<domaine>-composition.ts` (`compose<Domaine>` boot-validé : carriers ≡ `<DOMAINE>_COMMAND_TYPES`, queries ≡ catalogue, réactions fermées si aucune ratifiée). Tests : conformité des porteurs, composition (fail closed, instances partagées).

## Étape 5 — `adapters-persistence-<domaine>` (Sprint 2)
Copier `adapters-persistence-identity` : `prisma/schema.prisma` (RC-1 : Snapshot par unité ; Fact/Outbox/Inbox **seulement** pour les unités à faits), `migrations/0001_init` SQL manuel (clé R-A en contrainte si exprimable), `client/`, `serialization/`, `snapshot/`, `fact-stream/`, `outbox/`, `retention/` (un moteur par unité), `repository/`, `concurrency/` (classification), `read-model/`, `relay/`, `module/`, `testing/` (fixture, mother). Tests : `integration.spec.ts` (**rejeu des contract suites**, atomicité, corruption, I-11), `relay-source.spec.ts` (relayContractSuite), `unit.spec.ts`. `vitest.config`: `fileParallelism:false`. `turbo.json` : `app-server#test` dépend du nouveau `#test`.

## Étape 6 — Composition & entrée (Sprint 2-3)
- `server-composition.ts` : client Prisma, registres, read adapters, `compose<Domaine>`, module I-11, validateur de boot, check de santé ; `server-config.ts` : variable de base + paramètres produit des policies.
- Gateway : ajouter les commandes du domaine à la **table d'admission** de `/commands` (et ses lecteurs à `/queries`) — rien d'autre ; les droits restent chez les propriétaires (M-9) ; les verbes dont l'émetteur n'est pas tranché (RFC-002) restent **non admis**.
- e2e dans `gateway.spec.ts` : la route entière du domaine.

## Étape 7 — Mécanismes (Sprint 4, si le domaine en a)
Un paquet `adapters-<domaine>-<capacité>` par capacité ; ports possédés par le consommateur ; coutures injectées (fetch, horloge, secrets) ; fournisseurs simulés en CI.

## Étape 8 — Clôture
Domain Checklist cochée avec preuves → Features fermées avec déclaration → Production Readiness Checklist → **certificat** sur l'Epic (format fixé) → ratification CTO.

## Budget de référence (observé sur Identity)
Sprint 1 : 6 PR (#134-#139) · Sprint 2 : 4 PR (#141-#143 + gouvernance) · Sprint 3 : 2 PR (#149-#150) · Sprint 4 : 2 PR (#151-#152). Chaque PR < 600 lignes nettes, gate < 3 min en CI. Un domaine à deux unités et cinq commandes = ~14 PR.

## Étape 9 — Démontrer la conformité au REFERENCE DOMAIN (S0-4)
Avant le certificat : dérouler la section I de la Domain Checklist — la comparaison explicite à Identity, brique par brique, différences justifiées. Le certificat du domaine cite ce relevé de comparaison.
