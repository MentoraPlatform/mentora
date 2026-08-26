# Identity Reference Handbook — le domaine de référence de Mentora

**Statut** : standard officiel (décision CTO, lot S4-Stabilization, 2026-08-19) · **Propriétaire** : CTO · **Modèle** : le domaine Identity & Access tel que livré aux Sprints 1-4 (certificat v1.3, develop `a55c502`).

> Ce manuel ne légifère pas : il **montre** comment le Corpus (`docs/canon/`) a été implémenté une fois, à la lettre, et décrète que tout domaine suivant **copie ce modèle exactement**. En cas de conflit avec la Constitution, la Constitution prévaut.

## 0. Le modèle en une page

Un domaine Mentora est **cinq paquets et une composition**, tous déjà présents pour Identity :

| Anneau | Paquet | Propriété | Dépend de |
|---|---|---|---|
| Langage publié | `contracts-<domaine>` | Wires (commands, events, queries), ids brandés, unions de refus, validation par type, sérialiseurs déterministes | `contracts`, `kernel` |
| Domaine | `domain-<domaine>` | Unités (aggregates), entités, VOs, faits, commandes de domaine, factories, policies, specifications, **ports du domaine**, snapshots, références mémoire + **contract suites** | `contracts-<domaine>`, `kernel` |
| Application | `application-<domaine>` | Définitions de Séquence (le plug), porteurs (Application Services), seams wire→domaine, ports de lecture (capability), composition `compose<Domaine>` boot-validée | `application-kernel`, `domain-*`, `contracts-*` |
| Adapters sortants | `adapters-persistence-<domaine>` (+ `adapters-<domaine>-<capacité>`) | Prisma schema + migrations, moteurs de rétention, repositories, outbox/fact-stream, read adapters, relay source, mécanismes (coffre, hachage, fédération), **rejeu des contract suites sur moteur réel** | tout ce qui précède + `runtime-*` |
| Composition | `apps/server/src/composition/server-composition.ts` | Le Root : seul lieu des types concrets (I-2), Pure DI, tables fermées, validateurs de boot | tout |

Le graphe est acyclique par construction (I-12) : **entrants → Dispatch → Séquences → ports → sortants → fournisseurs**. Rien ne remonte.

## 1. Comment construire un domaine (l'ordre des lots)

L'ordre Identity est l'ordre officiel — il a été prouvé sans retour arrière :

1. **Langage** (`contracts-<domaine>`) : ids, unions de refus, wires des commandes ratifiées + `validate<Domaine>Command` par type (toutes les violations listées). Sprint 1 Identity : PR #134.
2. **Unités** (`domain-<domaine>`) : une unité par lot, machine gelée, factory, faits, snapshot, port du domaine, référence mémoire, **contract suite du port**. PRs #135-#138.
3. **Porteurs** (`application-<domaine>`) : une Séquence par commande ratifiée, seams, porteurs ennuyeux. PRs #136/#139.
4. **Persistance** : schema + migration 0001, moteurs de rétention, repositories, read adapters, relay source, **rejeu des suites sur PostgreSQL réel** (c'est LE critère d'acceptation). Sprint 2, PRs #141-#142.
5. **Composition** : `compose<Domaine>` boot-validé, tables fermées comparées aux catalogues, branché au Root. PR #143.
6. **Entrée** : admission du domaine aux surfaces du gateway (tables déclarées à la composition). Sprint 3, PR #150.
7. **Mécanismes** : adapters de capacité (coffre, hachage, fédération…), ports possédés par leur consommateur. Sprint 4, PRs #151-#152.

Chaque lot = une branche, une PR, une gate verte, un merge tracé, des issues fermées avec preuve (voir §9-§10).

## 2. Comment écrire une Aggregate

Modèle : [`domain-identity/src/aggregate/credential.ts`](../../platform/packages/domain-identity/src/aggregate/credential.ts) et [`session.ts`](../../platform/packages/domain-identity/src/aggregate/session.ts).

- **Classe immuable, constructeur privé**, `static _born(...)` appelé par la Factory seule (F3.1 : la naissance est la porte de la factory).
- **La machine d'états est celle du catalogue §8, gelée** : chaque transition est une méthode qui retourne `Result<Unit, Refusal>` — une **nouvelle instance**, jamais une mutation. Transition absente = `TransitionUnavailable` (famille `-Unavailable` ratifiée).
- **Faits** : `pendingFacts` portés par l'instance, `version` avance d'un par fait, `retained()` les vide. Un fait = `<Truth><PastParticiple>` (MENTORA0003), « références et natures, aucune matière ».
- **Sans fait = sans champ** : la Session n'a PAS de `pendingFacts` — la loi « aucun fait publié » est structurelle et verrouillée par le test de surface de clés (`Object.keys(session).sort()`).
- **Snapshot** : `toSnapshot()` / `static fromSnapshot()` — photo privée au registre, jamais un contrat ; corruption = exception dédiée.
- **Aucun secret, aucun port, aucune horloge** : l'unité reçoit l'instant dans la commande, ne parle à personne.
- **Vocabulaire** : jamais inventé. Un nom absent du dictionnaire = trou **enregistré** dans le code (commentaire « recorded canon gap ») et tranché au lot qui l'exige, jamais complété en silence.

## 3. Comment écrire un Port

Modèle : [`domain-identity/src/ports/credential-repository.ts`](../../platform/packages/domain-identity/src/ports/credential-repository.ts), [`session-repository.ts`](../../platform/packages/domain-identity/src/ports/session-repository.ts), [`application-identity/src/read/ports/identity-state-read.port.ts`](../../platform/packages/application-identity/src/read/ports/identity-state-read.port.ts).

- **Le port appartient à son consommateur** (I-4) : registre → domaine ; lecture/capacité → application (ou gateway pour ses propres besoins, ex. `ProofMaterialVerifyPort`).
- **Forme gelée** : `byId → Promise<Option<T>>`, `retain(unit, context?) → Promise<Result<void, Refusal>>` (le `context?` est RFC-001). Les parcours déclarés (`activeByPersonAndKind`, `activeByCredential`) sont les **sondes** des clés R-A et des cascades — jamais une recherche libre.
- **Nommage** : `<Truth>Repository` pour le registre d'UNE vérité ; `<Capability>Port` pour tout le reste (F2.5 §9) — jamais un « QueryRepository ».
- **Un port de lecture sans Query ratifiée** est un port de **capacité** (précédent : les deux lectures du gate) ; la table de Query reste fermée et vide si le catalogue F3.3 §5 n'en déclare aucune.

## 4. Comment écrire une Policy

Modèle : [`domain-identity/src/policies/proof-requirement.policy.ts`](../../platform/packages/domain-identity/src/policies/proof-requirement.policy.ts).

- Nom du catalogue §6, **paramètres = configuration produit** publiés (`<Name>PolicyParams`), construite **au Root** et injectée, jamais instanciée en chemin.
- Elle **juge** et retourne `Result<..., Refusal>` ; elle ne lit rien, ne retient rien.
- Pas d'ordre implicite entre valeurs opaques : **allowlist** et **tables déclarées** (`compositions: [{of, yields}]`) — une combinaison non déclarée refuse (fail closed). Aucune algèbre inventée.

## 5. Comment écrire une Application Sequence (le plug + le porteur)

Modèle : [`application-identity/src/definitions/session-sequence-definition.ts`](../../platform/packages/application-identity/src/definitions/session-sequence-definition.ts) + [`services/session-application-services.ts`](../../platform/packages/application-identity/src/services/session-application-services.ts).

- **Une `SequenceDefinition` par domaine-unité** : `commandTypeOf`, `actIdentityOf`, `receive` (délègue à `validate<Domaine>Command`, refuse un type étranger en A-1), `load` (byId seul), `validate` (le seam wire→domaine + instant injecté), `act` (l'unité ou la factory décide), `retain(unit, context)` (transmet RFC-001).
- **Un porteur par commande** (A-1) : classe `<Command>ApplicationService` qui construit son `SequenceBuilder` (`.withDefinition().withClock().withJournal()` + `.withMaxAttempts()` **conditionnel**) et délègue `execute`. Il ne décide rien : un `act` de naissance refuse un id habité (R-B), un `act` de transition refuse l'absence (`absentRefusal`).
- **Le pipeline retourne des outcomes, ne jette jamais** : `executed | refused | exception | abandoned`.
- **Lecture** : une `ReadDefinition` par Query **ratifiée** (`entitled` = grille R-C de F3.3 §5, `read`, `absent`, `respond` qui STRIP le domaine). Aucune Query ratifiée → aucun lecteur, table vide **déclarée** à la composition.

## 6. Comment écrire une Contract Suite

Modèle : [`domain-identity/src/testing/credential-repository-contract-suite.ts`](../../platform/packages/domain-identity/src/testing/credential-repository-contract-suite.ts) (7 promesses) et `session-repository-contract-suite.ts` (5).

- **Écrite une fois (I-10)**, signature `(name, provider: { make(): Promise<{repository}> })`, rejouée sur la référence mémoire (dans le domaine) ET sur le moteur réel (dans l'adapter) — **le rejeu réel EST le critère d'acceptation de la persistance**.
- Elle vit sur un **sous-chemin d'export** (`./contract-suite`) parce qu'elle importe vitest — jamais dans le barrel (la leçon des barrels).
- Elle promet les **lois**, pas les mécanismes : présence/absence valeur, clé R-A appliquée ET libérée, R-B, version périmée = Failure transitoire jetée (S-3), rétention état-seul quand la loi l'exige.
- La référence mémoire est **pure** (aucun import de test-runner), exportée du barrel.

## 7. Comment écrire un Adapter

Modèles : [`adapters-persistence-identity`](../../platform/packages/adapters-persistence-identity/README.md) (sortant, registre), [`adapters-identity-federation`](../../platform/packages/adapters-identity-federation/README.md) (sortant, capacité), [`apps/server/src/gateway/`](../../platform/apps/server/src/gateway/) (entrant).

- **Sortant** : implémente un port, parle à un fournisseur, **ne dispatche jamais** (I-12). Nommage `Prisma<Truth>RepositoryAdapter`, `Prisma<Capability>Adapter`. Mécanique séparée : moteur de rétention (ordre gelé : version → faits → photo → outbox, dans UNE transaction sérialisable), stores, mappers via les portes du domaine (`toSnapshot/fromSnapshot`), classification des collisions **après rollback** (R-A → Refus, R-B → Refus, version → Failure jetée, reste → Failure).
- **Entrant** : sa bouche unique est le Dispatch ; tables d'admission **fermées et déclarées** à la composition ; dialecte (HTTP) documenté comme **mécanisme** ; le Refus reste une VALEUR dans le corps.
- **Mécanismes** : la matière meurt dans l'adapter (I-8), les types fournisseur meurent dans l'adapter (I-7), fetch/horloge/secrets sont des **coutures injectées** (testables sans réseau, secrets par référence).
- **Migrations** : SQL rédigé à la main, expand-only (S-7), déployées par la gate (`prisma migrate deploy`), jamais par le boot.
- **Client Prisma** : généré dans `src/generated` (ignoré du lint/coverage), datasource par variable déclarée `MENTORA_<DOMAINE>_DATABASE_URL`.

## 8. Comment écrire les tests

Quatre couches, chacune avec son modèle réel :

| Couche | Ce qu'elle prouve | Modèle |
|---|---|---|
| Domaine (`*.spec.ts` du domaine) | Machine gelée, invariants, faits, snapshot roundtrip + corruption, surface de clés, **contract suite sur mémoire** | `credential-lifecycle.spec.ts`, `session-lifecycle.spec.ts` |
| Application | Conformité de chaque porteur (executed/refused/exception), A-1, composition boot-validée (tables ≡ catalogues, fail closed, instances partagées) | `session-application-services.spec.ts`, `identity-composition.spec.ts` |
| Adapter | **Rejeu des contract suites sur PG réel**, atomicité (tout ou rien), corruption, cycle I-11, relais, mécanismes (hasher, coffre) ; unitaires sans DB pour mappers/sérialiseurs | `integration.spec.ts`, `relay-source.spec.ts`, `unit.spec.ts`, `federation.spec.ts` |
| Exécutable | Boot réel, HTTP réel port éphémère, **la route entière** (entrée → commande → outbox → relais), adversarial (voix plate, couture morte, zéro matière par scan) | `apps/server/src/gateway.spec.ts`, `server.spec.ts` |

Règles : cible de couverture ≥ 95/95/95 par paquet — **mesurée, pas encore gated** (audit S4-Stabilization : le preset ne déclare aucun seuil et la CI ne lance pas `--coverage` ; l'enforcement est une décision CTO ouverte) ; tests d'intégration **`describe.skipIf(url === undefined)`** sur la variable déclarée (la gate les exécute pour de vrai) ; `fileParallelism: false` dès que deux fichiers partagent une base ; aucune horloge ambiante (`FakeClock.at`), aucun réseau (coutures), aucun fournisseur réel en CI.

## 9. Comment ouvrir une PR

1. Branche depuis `develop` à jour : `feature/<domaine>-<lot>` (ou `docs/...`).
2. **Gate locale verte** : `pnpm verify` depuis `platform/` avec les deux `MENTORA_*_DATABASE_URL` exportées (128+ tâches, 0 rouge).
3. Commit conventionnel, message = la loi appliquée (pas la liste des fichiers), trailer `Co-Authored-By` si assisté.
4. Titre `feat(<contexte>): <la loi en une phrase> [STORY #n + #m]`, corps **Type / Description (lois citées) / Preuves (tests, gate) / Issues (`Closes #task`)** — les stories se ferment à la main avec preuve (voir §10).
5. Toute PR qui touche `docs/canon/` (y compris `decisions/`) porte le label **`titre-vii`** ; si le label est posé après l'ouverture, un commit vide relance l'event.
6. Checks requis `verify` + `docs-audit` verts ; **merge squash** ; tant que l'organisation n'a qu'un compte, **trace de bypass** obligatoire en commentaire (Lot 3 §7) avant le merge ; branche supprimée.

## 10. Comment fermer une Story

Une story se ferme avec un commentaire de **preuve**, jamais un « done » :

- la PR et le SHA de develop ;
- **les lois appliquées** (numéros : R-A/R-B, A-1…A-10, I-2/I-8/I-12, M-9, T-8/T-14, V-2…) ;
- ce qui a été **prouvé** (tests nommés, gate) ;
- ce qui reste **déféré**, où et pourquoi (story rattachée, RFC/ADR, lot) — un déférement est écrit, jamais implicite.

La Feature se ferme quand toutes ses stories sont fermées **ou** déférées avec justification canon/ordre ; le commentaire de fermeture porte la **déclaration officielle** (périmètre livré / déféré). L'Epic reçoit le **certificat** (format fixé : critères PASS/PARTIAL/FAIL sur l'état réel, Known Limitations réelles, Approved By, date, chaîne de preuve).

## 11. Les pièges connus (appris, payés, consignés)

- Une suite contractuelle dans un barrel casse les consommateurs (vitest importé) → sous-chemin.
- Rebâtir `contracts-*` avant de typer le domaine (résolution par `dist`).
- `pipeline` retourne `{kind:'exception'}`, il ne jette pas — ne jamais `rejects.toThrow` sur une Séquence.
- Deux fichiers spec sur une même base = `fileParallelism:false` **et** dépendances turbo sérialisées (`app-server#test` ← les deux `adapters-persistence-*#test`).
- MENTORA0001 interdit `user` jusque dans les noms de variables ; MENTORA0003 impose `<Truth><PastParticiple>` sous `events/`.
- Un event GitHub `opened` sans label ne protège pas le canon : poser le label puis pousser un commit vide.
- Ne jamais chaîner `cmd <<'EOF' || fallback` puis un second heredoc (le premier avale le second) ; préférer l'outil d'édition aux remplacements `node -e` sur fichiers CRLF.

## 12. La règle de comparaison (S0-4, 2026-08-26)

Identity est le **REFERENCE DOMAIN déclaré**. Tout nouveau domaine est **comparé à Identity, systématiquement**, avant chaque fermeture de Feature et au certificat : mêmes anneaux, mêmes formes de ports, mêmes canaux (Refus valeur / violation / Failure), mêmes suites contractuelles rejouées mémoire puis moteur réel, mêmes preuves. La comparaison est **explicite** : le commentaire de fermeture cite le fichier d'Identity pris pour modèle pour chaque brique (« copié de X, différences : … justifiée par … »). Une différence non justifiée par le Canon ou une RFC ratifiée est un écart — elle bloque la fermeture. Précédent : Account (A01-A03) a suivi cette règle avant qu'elle soit écrite ; la seule divergence (loi de version +1 par acte, `unretainedActs`) est documentée et justifiée par les verbes sans fait.
