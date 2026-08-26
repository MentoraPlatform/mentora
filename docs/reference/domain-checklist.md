# Domain Checklist — obligatoire avant toute fermeture de Feature

**Statut** : standard officiel (CTO, 2026-08-19) · Dérivée du domaine de référence Identity · Chaque case se coche avec une **preuve** (fichier, test, PR) dans le commentaire de fermeture de la Feature. Une case non cochée = Feature ouverte, ou fermée avec **déférement écrit** (story rattachée + justification canon/ordre).

## A. Canon & vocabulaire
- [ ] Chaque unité, fait, commande, policy, specification porte **le nom du catalogue** (`docs/canon/projection/catalogs/`), jamais un synonyme.
- [ ] Aucune commande, aucun fait, aucune Query hors catalogue ; une Query absente du catalogue ⇒ table de lecture **fermée et vide**, déclarée.
- [ ] Tout trou de vocabulaire est **enregistré** dans le code (commentaire « recorded canon gap ») et tranché au lot prévu — jamais complété.
- [ ] Toute évolution de contrat est **additive** (V-2) ; supprimer/renommer = contrat nouveau = Titre VII.
- [ ] Les lois citées dans le code (R-A/R-B, A-*, I-*, M-*, T-*, S-*, V-*) renvoient à un texte réel du Corpus.

## B. DDD & unités
- [ ] Constructeur privé, `_born` par la Factory seule, instances immuables, transitions = nouvelles instances.
- [ ] Machine d'états = catalogue §8 ; transition absente = `TransitionUnavailable`.
- [ ] Clé R-A **déclarée** par une Specification nommée, **appliquée** par le registre à la rétention, **refusée** comme Décision motivée.
- [ ] R-B sans exception : revenir = unité nouvelle à provenance citée.
- [ ] Aucun secret, aucune matière, aucun port, aucune horloge dans l'unité ; les faits portent références et natures seules.
- [ ] Snapshot privé (`toSnapshot/fromSnapshot`), corruption = exception dédiée.

## C. Application (CQRS)
- [ ] Une `SequenceDefinition` par unité, un porteur par commande (A-1), pipeline jamais réimplémenté.
- [ ] `retain(unit, context)` transmet le `RetentionContext` (RFC-001).
- [ ] Lectures : une `ReadDefinition` par Query ratifiée avec sa grille R-C ; la réponse STRIP le domaine.
- [ ] `compose<Domaine>` : Pure DI, tables fermées **comparées aux catalogues**, fail closed, instances partagées (une horloge, un journal).

## D. Eventing & circulation
- [ ] Faits dans le fact-stream (append-only, `(id, sequence)` unique) ET l'Outbox de faits dans la **même transaction** (A-3).
- [ ] Outbox porte `correlationId/causationId` quand ils existent, NULL sinon (RFC-001).
- [ ] Relay source : claim par sujet, un en vol par sujet, quarantaine + Signal (M-8) ; rejeu de `relayContractSuite` sur moteur réel.
- [ ] Unités « sans fait » : **aucune** table outbox/fact-stream — l'absence est la preuve.

## E. Persistance
- [ ] Schema Prisma = modèle canonique RC-1 ; migrations SQL manuelles, expand-only (S-7), déployées par la gate.
- [ ] Moteur de rétention : version → faits → photo → outbox, transaction sérialisable, classification APRÈS rollback.
- [ ] **Les contract suites du domaine rejouent vertes sur PostgreSQL réel** (critère d'acceptation).
- [ ] Module de cycle de vie (I-11) enregistré au Root ; validateur de boot « base atteignable » ; check de santé readiness.

## F. Gateway & sécurité
- [ ] Entrant → Dispatch seul (I-12) ; tables d'admission fermées et déclarées.
- [ ] Gate borné à la session (M-9) ; droits métier chez les propriétaires (T-9/T-10).
- [ ] Rejets de preuve = une voix plate ; matière morte à l'entrée (I-8) ; zéro matière hors coffre **prouvé par scan**.
- [ ] Secrets par référence (`SecretReference`), jamais en clair dans config/tests/logs.

## G. Tests & gate
- [ ] Couverture ≥ 95/95/95 par paquet **mesurée et citée** (`vitest run --coverage`) — non gated à ce jour ; `pnpm verify` 0 rouge ; 3 runs CI verts consécutifs pour toute modification de workflow.
- [ ] Intégration gated sur la variable déclarée ; `fileParallelism:false` + dépendances turbo si base partagée.
- [ ] Aucun fournisseur réel, aucun réseau, aucune horloge ambiante dans les tests.

## H. Documentation & gouvernance
- [ ] README par paquet (loi, asymétries, critère d'acceptation, client généré).
- [ ] ADR/RFC à jour (statut réel : proposée / en instruction / ratifiée) ; label `titre-vii` sur toute PR canon.
- [ ] Stories fermées avec preuve ; déférements écrits ; Feature fermée avec déclaration ; certificat d'Epic mis à jour sur l'état réel.

## I. Comparaison au domaine de référence (obligatoire — S0-4)
- [ ] Chaque brique (unité, port, policy, séquence, suite, adapter) cite son modèle Identity dans le commentaire de fermeture.
- [ ] Toute différence avec Identity est écrite ET justifiée (Canon, RFC ratifiée, ou caractéristique de l'unité — ex. loi de version d'Account).
- [ ] Aucune différence non justifiée ne subsiste ; sinon la Feature reste ouverte.
