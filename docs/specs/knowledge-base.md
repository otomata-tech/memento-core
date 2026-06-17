# Memento — spec fondatrice (base de connaissance structurée, MCP-first)

> **Memento** — *memento mori, note tout.* Un substrat de connaissance
> **structuré, sourcé, vivant et auditable**, consommé par des agents via MCP.
> Là où un RAG documentaire stocke un sac de documents, Memento représente le
> **savoir-faire** : concepts, règles, exceptions, procédures — reliés, sourcés,
> et tenus à jour par une boucle propose-valide.
>
> **Fresh start** (2026-05-29). Memento **ne reprend pas** le code de l'ancien
> Mento (`mento.cc` — portail de docs adossé à des repos GitHub, Flask/React) :
> philosophie opposée (fichiers git + graphe dérivé des liens vs blocs
> first-class en DB). On garde **le nom** et l'intention « note tout ».
>
> **Multi-workspace** : Memento est par nature multi-projets (le substrat de
> connaissance transverse de tous tes projets). Chaque workspace a sa propre
> doctrine. **Demo KB / Kairos AI = workspace #1** (cf. memory
> `project_kairos_ai_strategy`). « Intégrer dans mes projets » = chaque projet/
> agent consomme le MCP Memento — exactement ce que faisait déjà l'ancien Mento,
> branché partout.

Statut : **spec vivante, implémentée** (Lots 1–5 livrés, prod `mento.cc`).
Préfixe `mem_`. L'implémentation fait foi : schéma canonique `server/src/schema.ts`
(Drizzle), surface MCP `supabase/functions/mcp/index.ts`. Le backlog vit dans les
**issues GitHub** du repo, plus dans ce document.

---

## 1. Positionnement

**Produit autonome.** Modèle de données, surface et déploiement propres. Aucune
FK ni table partagée avec les projets consommateurs (example-kb, etc.).

- **Interop par MCP uniquement.** Memento expose ses verbes `mem_*` à des agents
  (Claude Desktop, Claude Code, claude.ai, futurs agents Kairos AI). Un agent peut
  consommer simultanément le MCP d'un projet (ex. example-kb) **et** le MCP Memento
  pour croiser données métier et doctrine. Le couplage s'arrête au protocole.
- **Multi-workspace = multi-tenant.** Un `MemWorkspace` = un projet/domaine de
  savoir, isolé. L'accès est gouverné par l'org propriétaire (`mem_orgs` +
  `mem_memberships` — cf. `docs/access-control.md`). Demo KB est le premier.
- **L'ancien Mento n'est pas le point de départ.** Son contenu (docs markdown dans
  des repos git) peut servir de *donneur de contenu* à l'amorçage (§9), pas de base.

Cœur de valeur — ce qu'aucun produit sur étagère ne donne : le **bloc** comme entité
adressable, une **colonne vertébrale de sections** par workspace, des **liens
transverses typés**, le **sourcing au grain du bloc**, les **commentaires**, un
**statut de vérification**, le **versioning avec motif**, et la **boucle
propose-valide** d'ingestion.

---

## 2. Principes directeurs

1. **Serveur bête, agent intelligent.** Le MCP stocke, garantit les invariants
   (états invalides impossibles) et journalise l'intention. L'extraction de claims
   et le jugement d'impact sont faits par l'agent appelant (Claude). **Pas de LLM
   côté serveur.**
2. **Doctrine-first.** Le point d'entrée `mem_doctrine({workspace})` rend une carte
   compacte (toujours chargeable) + les méta-instructions d'usage. C'est l'équivalent
   `get_claude_md` de GR/Blitz, par workspace.
3. **Propose, ne s'applique jamais seul.** Toute restructuration et toute ingestion
   passent par un `dryRun` / un objet `MemIngestion` revu par un humain. Les
   **contradictions** sont le cas précieux : jamais auto-appliquées.
4. **Ancrage qui survit.** Chaque bloc porteur de doctrine pointe vers la/les
   source(s) qui le justifient. Auditable après N réorganisations.
5. **Contrainte en haut, liberté en bas.** Hiérarchie de sections stricte et peu
   profonde (épine dorsale) ; composition libre de blocs typés dans les documents.
6. **Le bloc est la maille fine.** Sources/commentaires/liens s'attachent au bloc
   entier. Un bloc qui aurait besoin de deux sources pour deux affirmations doit être
   scindé en deux blocs (pas d'annotation intra-bloc → pas de Portable Text).
7. **Isolation par workspace.** Accès gouverné par l'appartenance à l'org
   propriétaire du workspace (orgs/memberships maison, rôles admin/curator/member —
   `docs/access-control.md`). Une org = un **périmètre de partage** (mission/client,
   perso). Asset interne : pas d'exposition publique en v1.

---

## 3. Modèle de données

Rendu ci-dessous en pseudo-**Prisma** pour la lisibilité. **L'implémentation fait
foi** : Drizzle/PostgreSQL dans `server/src/schema.ts` (schéma canonique, tables
`mem_*`, importé par les deux runtimes). Tout store relationnel convient ; le modèle
est agnostique. S'y ajoutent côté accès : `mem_orgs`, `mem_memberships`,
`mem_user_prefs` (KB par défaut) — cf. `docs/access-control.md`.

```prisma
enum MemBlockType {
  PROSE
  PRINCIPE
  REGLE
  EXCEPTION
  EXEMPLE
  PROCEDURE
  MISE_EN_GARDE
  DEFINITION
  QUESTION
  PROMPT_PORTEUR   // cf. format cible « fiche outil » (prompt destiné au porteur)
  PROMPT_SYSTEME   // garde-fous / retours d'expérience du sous-agent
}

enum MemDocStatus      { ACTIVE DEPRECATED }  // pas de brouillon : le « pas encore validé » vit dans MemIngestion (PROPOSED), cf. #59
enum MemLinkRelation   { REFERENCES DEPENDS_ON CONTRADICTS SUPERSEDES RELATED }
enum MemSourceKind     { FILE URL MANUAL }
enum MemCommentTarget  { BLOCK DOCUMENT SECTION }
enum MemIngestionStatus{ PROPOSED APPLIED REJECTED PARTIAL }

// ── Workspace : le tenant. Un domaine de savoir isolé (Demo KB = #1) ────
model MemWorkspace {
  id        String   @id @default(cuid())
  slug      String   @unique           // identifiant URL/MCP ("example-kb")
  name      String
  summary   String   @default("")
  orgId     String?  @map("org_id")     // org propriétaire (mem_orgs) — gouverne l'accès
  archivedAt DateTime? @map("archived_at") // archivage réversible (masque la KB)
  createdAt DateTime @default(now()) @map("created_at")

  sections MemSection[]
  @@map("mem_workspaces")
}

// ── Épine dorsale : arbre de sections (peu profond, contraint), par workspace
model MemSection {
  id          String   @id @default(cuid())
  workspaceId String   @map("workspace_id")
  parentId    String?  @map("parent_id")
  title       String
  slug        String
  summary     String   @default("")   // court — alimente la carte/doctrine + brief
  position    Int      @default(0)
  depth       Int      @default(0)     // dénormalisé, maintenu en service (invariant profondeur)
  createdAt   DateTime @default(now()) @map("created_at")
  updatedAt   DateTime @updatedAt      @map("updated_at")

  workspace MemWorkspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  parent    MemSection?  @relation("MemSectionTree", fields: [parentId], references: [id], onDelete: Restrict)
  children  MemSection[] @relation("MemSectionTree")
  documents MemDocument[]

  @@unique([workspaceId, parentId, slug])
  @@index([workspaceId, parentId, position])
  @@map("mem_sections")
}

// ── Conteneur éditorial : un document = une suite ordonnée de blocs ──────────
model MemDocument {
  id        String       @id @default(cuid())
  sectionId String       @map("section_id")
  title     String
  slug      String
  summary   String       @default("")
  kind      String?                          // libre : "outil", "methode", "concept", "playbook"
  status    MemDocStatus @default(ACTIVE)
  position  Int          @default(0)
  createdBy String?      @map("created_by")
  updatedBy String?      @map("updated_by")
  createdAt DateTime     @default(now()) @map("created_at")
  updatedAt DateTime     @updatedAt      @map("updated_at")

  section MemSection @relation(fields: [sectionId], references: [id], onDelete: Restrict)
  blocks  MemBlock[]

  @@unique([sectionId, slug])
  @@index([sectionId, position])
  @@map("mem_documents")
}

// ── L'atome adressable ──────────────────────────────────────────────────────
model MemBlock {
  id         String       @id @default(cuid())
  documentId String       @map("document_id")
  type       MemBlockType @default(PROSE)
  content    String                          // markdown
  position   Int          @default(0)
  verifiedAt DateTime?    @map("verified_at") // statut de confiance (inspiré Slite)
  verifiedBy String?      @map("verified_by")
  createdBy  String?      @map("created_by")
  updatedBy  String?      @map("updated_by")
  createdAt  DateTime     @default(now()) @map("created_at")
  updatedAt  DateTime     @updatedAt      @map("updated_at")
  // search_vector tsvector — hors DSL, maintenu par trigger (cf. §7)

  document  MemDocument     @relation(fields: [documentId], references: [id], onDelete: Cascade)
  sources   MemBlockSource[]
  linksFrom MemLink[]       @relation("MemLinkFrom")
  linksTo   MemLink[]       @relation("MemLinkTo")

  @@index([documentId, position])
  @@map("mem_blocks")
}

// ── Sources : entités autonomes et réutilisables. Stockage de fichiers propre.
model MemSource {
  id        String        @id @default(cuid())
  kind      MemSourceKind
  title     String
  ref       String?                             // FILE: clé de stockage interne · URL: l'URL · null si MANUAL
  citation  String?                             // "Groff, Boîte à outils créativité, 4e éd., p.42"
  createdAt DateTime      @default(now()) @map("created_at")

  blocks MemBlockSource[]
  @@index([kind])
  @@map("mem_sources")
}

model MemBlockSource {
  blockId   String   @map("block_id")
  sourceId  String   @map("source_id")
  locator   String?                       // page, ancre, span cité dans la source
  createdAt DateTime @default(now()) @map("created_at")

  block  MemBlock  @relation(fields: [blockId], references: [id], onDelete: Cascade)
  source MemSource @relation(fields: [sourceId], references: [id], onDelete: Restrict)

  @@id([blockId, sourceId])
  @@map("mem_block_sources")
}

// ── La dose minimale de graphe : liens transverses typés bloc↔bloc ──────────
model MemLink {
  id          String          @id @default(cuid())
  fromBlockId String          @map("from_block_id")
  toBlockId   String          @map("to_block_id")
  relation    MemLinkRelation
  note        String?                        // pourquoi ce lien
  createdBy   String?         @map("created_by")
  createdAt   DateTime        @default(now()) @map("created_at")

  fromBlock MemBlock @relation("MemLinkFrom", fields: [fromBlockId], references: [id], onDelete: Cascade)
  toBlock   MemBlock @relation("MemLinkTo",   fields: [toBlockId],   references: [id], onDelete: Cascade)

  @@unique([fromBlockId, toBlockId, relation])
  @@index([toBlockId])
  @@map("mem_links")
}

// ── Annotations (le principe Notion) — humaines ou agent ────────────────────
model MemComment {
  id         String           @id @default(cuid())
  targetType MemCommentTarget
  targetId   String           @map("target_id")
  body       String
  author     String                                  // user id ou nom d'agent
  authorKind String           @default("human") @map("author_kind") // human | agent
  resolvedAt DateTime?         @map("resolved_at")
  createdAt  DateTime          @default(now()) @map("created_at")

  @@index([targetType, targetId])
  @@map("mem_comments")
}

// ── Versioning avec motif (le « git diff » devient un journal d'intention) ──
model MemRevision {
  id          String   @id @default(cuid())
  workspaceId String   @map("workspace_id")
  targetType  String   @map("target_type")  // block|document|section|link|structure
  targetId    String?  @map("target_id")
  op          String                          // create|update|move|delete|set_type|verify|link|unlink|split_section|merge_sections|deprecate
  reason      String
  actor       String
  actorKind   String   @default("human") @map("actor_kind")
  before      Json?
  after       Json?
  ingestionId String?  @map("ingestion_id")
  createdAt   DateTime @default(now()) @map("created_at")

  @@index([workspaceId, targetType, targetId, createdAt])
  @@index([ingestionId])
  @@map("mem_revisions")
}

// ── Boucle propose-valide matérialisée : un change-set proposé, revu, appliqué
model MemIngestion {
  id          String             @id @default(cuid())
  workspaceId String             @map("workspace_id")
  sourceId    String?            @map("source_id") // la source qui déclenche l'ingestion
  title       String
  status      MemIngestionStatus @default(PROPOSED)
  proposal    Json                                  // [{op, target, payload, rationale, class}]
  summary     String             @default("")
  createdBy   String?            @map("created_by")
  decidedBy   String?            @map("decided_by")
  createdAt   DateTime           @default(now()) @map("created_at")
  decidedAt   DateTime?          @map("decided_at")

  @@index([workspaceId, status])
  @@map("mem_ingestions")
}

// ── Doctrine éditable + config, par workspace (clé/valeur) ──────────────────
model MemSetting {
  workspaceId String   @map("workspace_id")
  key         String                         // ex "doctrine.preamble"
  value       String
  updatedAt   DateTime @updatedAt @map("updated_at")

  @@id([workspaceId, key])
  @@map("mem_settings")
}
```

---

## 4. Invariants (états invalides impossibles)

Garantis en service (transaction) — certains doublés par contrainte DB.

- **Scoping workspace** : sections, documents, blocs, révisions, ingestions, settings
  appartiennent à exactement un workspace ; aucune relation ne traverse deux workspaces
  (ex. un `MemLink` relie deux blocs du **même** workspace).
- **Arbre de sections** : profondeur ≤ 3 (à confirmer, §11), pas de cycle dans la
  chaîne `parentId`, `slug` unique entre frères d'un même workspace
  (`@@unique([workspaceId, parentId, slug])`).
- **Document** : `slug` unique dans sa section ; rattaché à exactement une section ;
  une section peut contenir simultanément sous-sections **et** documents.
- **Bloc** : appartient à exactement un document ; `position` ordonnée dans le doc.
- **Lien** : pas d'auto-référence (`from ≠ to`) ; unique `(from, to, relation)` ;
  les deux blocs existent (même workspace). Un `SUPERSEDES` **propose** (jamais
  n'applique) le passage du document/bloc cible en `DEPRECATED`.
- **Source** : `FILE ⇒ ref` (clé de stockage) ; `URL ⇒ ref` ; `MANUAL ⇒ citation`.
- **Mutation** : tout verbe mutant exige un `reason` non vide → écrit une `MemRevision`.
- **Restructuration** : atomique ; ne laisse pas de section vide sauf `allowEmpty`.
- **Ingestion** : `apply` n'agit que sur un `MemIngestion` en `PROPOSED` ; transaction
  tout-ou-`PARTIAL` (selon `acceptIds`) ; écrit une `MemRevision` par op appliquée
  (avec `ingestionId`).

---

## 5. Surface MCP (`mem_*`)

**42 verbes en prod** — l'implémentation fait foi (`supabase/functions/mcp/index.ts`).
Tous les verbes sont **scopés à un workspace**, résolu dans cet ordre : `workspace`
slug explicite > **KB par défaut** de l'utilisateur (`mem_use_workspace`, persistée
dans `mem_user_prefs`) ; ou un `path` préfixé `workspace/section/...` (chemin slugifié,
ex. `example-kb/strategie/creativite`). Les réponses renvoient la KB utilisée.

**Gating par rôle** (cf. `docs/access-control.md`) :
- *lecture* : tout membre de l'org propriétaire ;
- *écriture, structure, boucle* : `curator`/`admin` (`assertAccess {write:true}`) ;
- *archive / création de KB* : **admin de l'org** (`assertWorkspaceAdmin` / `mem_create_workspace`).
- la boucle propose-valide est **recommandée** (instructions serveur), pas imposée à un
  curator — un rôle « proposer » qui l'imposerait est tracké en issue #7.

### 5.0 Workspaces, orgs & doctrine

```ts
mem_workspaces()   // CARTE DE CONTEXTE : orgs (ton rôle) → KB, + KB par défaut (`default`)
mem_use_workspace({ workspace })       // fixe la KB par défaut (persistée par user)
mem_orgs()                             // orgs du caller : rôle, membres, KB — pour choisir où créer
mem_create_org({ name, slug? })        // crée un périmètre de partage ; le créateur devient admin
mem_create_workspace({ org, name, summary?, slug? })  // org-admin ; slug dérivé du nom si omis
mem_transfer_workspace({ workspace, toOrg })          // admin des DEUX orgs ; change le périmètre de partage
mem_set_doctrine({ workspace?, preamble })            // écrit le préambule (MemSetting "doctrine.preamble")
mem_update_workspace({ workspace?, name?, summary? }) // métadonnées ; le slug reste stable
mem_archive_workspace({ workspace?, archived? })      // org-admin ; réversible (archived:false)
```

### 5.1 Entrée & lecture (le serveur ne rend jamais de mur de texte non demandé)

```ts
mem_doctrine({ workspace? })
// { usedWorkspace, preamble, tree, conventions }
// preamble  : méta-instructions éditables (MemSetting "doctrine.preamble" du workspace) —
//             comment la base est organisée, quand utiliser chaque type de bloc,
//             le protocole d'usage des verbes, la règle propose-valide.
// tree      : arbre des sections (titre + summary + compteurs docs/blocs), SANS contenu.
// conventions: enums MemBlockType + MemLinkRelation, énumérés pour l'agent.

mem_section({ id | path })
// déplie une zone : sous-sections + documents (titre, summary, status, compteurs). Pas de blocs.

mem_document({ id | path })
// document complet : blocs ordonnés (id, type, content) + sources + liens + commentaires.

mem_block({ id })
// un bloc + ses sources/liens/commentaires (inspection chirurgicale).

mem_neighborhood({ blockId, depth?, relations?, direction? })
// traversée du graphe de liens : sous-graphe à depth sauts (1-3, défaut 1, cap 200 nœuds).
// nœuds = blocs (extrait + document/section + profondeur), arêtes = liens typés.
// direction out|in|both ; relations = filtre. Forer ensuite avec mem_block. (issue #17)

mem_search({ q? | likeBlockId?, workspace?, mode?, blockType?, sectionPath?, docKind?, maxHits? })
// LA recherche, HYBRIDE par défaut : full-text FR (tsvector, cf. §7) + sémantique (kNN
// pgvector, embeddings calculés à l'écriture), fusion RRF. matchedBy par hit.
// workspace:"*" = globale sur toutes les KB accessibles (hits étiquetés {workspace, org}).
// likeBlockId = blocs proches d'un bloc-ancre (dédup, suggestions de liens, ciblage d'ingestion).
// mode lexical|semantic force un régime ; embedding indisponible → dégrade en lexical, signalé
// (`modes`). NULL ignorés (backfill : npm run embed:backfill).

mem_revisions({ workspace?, targetType?, targetId?, limit? })
// journal des mutations (op, motif, acteur, avant/après), du plus récent au plus ancien.
```

(Les liens directs se lisent dans `mem_document`/`mem_block`, le multi-saut via
`mem_neighborhood` ; un verbe de découverte des sources, `mem_sources`, est tracké en issue #11.)

### 5.2 Écriture atomique

```ts
mem_add_document({ sectionId, title, summary?, kind?, blocks?, reason? })
// blocks : DEUX portes —
//   (a) markdown brut → auto-découpé en blocs (## → frontières, paragraphes → PROSE),
//       l'agent affine les types ensuite ;
//   (b) tableau [{ type, content }] → contrôle fin (sources attachées ensuite par bloc).

mem_add_block({ documentId, type, content, position?, reason? })
mem_update_block({ id, content?, type?, reason })          // reason obligatoire
mem_set_block_type({ id, type, reason })
mem_move_block({ id, toDocumentId?, position?, reason })   // sans position : à la fin
mem_delete_block({ id, reason })                           // snapshot conservé en révision

mem_attach_source({ blockId, sourceId? | kind+title+ref?/citation?, locator?, reason? })
// réutilise une source existante (sourceId) OU la crée à la volée — pas de mem_add_source séparé
mem_detach_source({ blockId, sourceId, reason? })          // détache le lien, pas la source

mem_link_blocks({ fromId, toId, relation, note?, reason? })
mem_unlink({ linkId, reason? })

mem_comment({ targetType, targetId, body, authorKind? })   // BLOCK|DOCUMENT|SECTION
mem_resolve_comment({ id })

mem_verify_block({ id, verified?, reason? })   // pose verifiedAt/By ; verified:false retire
```

### 5.3 Restructuration (composite, atomique, `dryRun`)

Verbes nommés = intention auditable (« scission de 3.2 », pas 4 micro-mouvements).
Les composites acceptent `dryRun: true` → renvoient le diff avant/après + impact, sans muter.

```ts
mem_create_section({ workspace?, parentId?, title, summary?, position? })  // profondeur ≤ 3
mem_rename_section({ id, title?, summary? })       // slug stable (les chemins ne cassent pas)
mem_delete_section({ id, reason? })                // section VIDE uniquement
mem_move_documents({ documentIds[], targetSectionId, dryRun? })
mem_split_section({ id, newSectionTitle, documentIdsToMove[], dryRun? })   // le cas canonique
mem_merge_sections({ sourceIds[], targetId, dryRun? })
mem_reorder({ parentId?, orderedChildIds[] })      // sections d'un parent OU docs d'une section
mem_deprecate_document({ id, supersededBy?, reason })   // obsolescence (status → DEPRECATED)
```

### 5.4 Boucle d'ingestion (change-set proposé → revu → appliqué)

L'intelligence est dans l'agent ; ces verbes ne font que **stocker l'intention**
et **appliquer sous invariants**.

```ts
mem_stage_changes({ workspace?, sourceId?, title, summary?, changes[] })
// changes[] = [{ op, payload, class?, target?, rationale? }]
//   op    : add_document | add_block | update_block | set_block_type | delete_block |
//           attach_source | detach_source | verify_block | move_block | link_blocks |
//           deprecate_document    (payload = les arguments du verbe correspondant)
//   class : CONFIRM | ENRICH | CONTRADICT | OBSOLETE   (la classification du diff)
// → crée un MemIngestion PROPOSED. Rien n'est muté.

mem_ingestion_get({ id })       // revue humaine : le diff classé op par op + état applied/error
mem_ingestion_list({ workspace?, status? })
mem_apply_ingestion({ id, acceptIds? })
// sans acceptIds : applique tout SAUF les CONTRADICT (tenues en attente) ;
// avec acceptIds : ce sous-ensemble seulement (→ APPLIED si tout passe, sinon PARTIAL).
// Une MemRevision par op appliquée, liée à l'ingestionId.
mem_reject_ingestion({ id, reason? })     // → REJECTED
```

---

## 6. La boucle d'ingestion, déroulée

Quand une nouvelle source arrive (PDF, note, retour d'expérience) :

1. **Conversion** — PDF/DOCX → markdown via un convertisseur (l'outil `ingest.py`
   d'openkairos-agent fait l'affaire, sans en dépendre), puis l'agent extrait les claims.
2. **Ciblage** — `mem_doctrine({workspace})` → l'agent identifie les 2-3 sections concernées.
3. **Chargement ciblé** — `mem_section`/`mem_document` sur ces zones uniquement (la
   fenêtre de contexte est le vrai mur, pas le temps — on ne charge jamais tout).
4. **Diff au grain du bloc** — pour chaque claim, l'agent classe vs les blocs existants :
   - `CONFIRM` → `attach_source` sur un bloc existant (renforce, ajoute une source) ;
   - `ENRICH` → `add_block` (nouveau nœud) ;
   - `CONTRADICT` → `link_blocks(..., CONTRADICTS)` + **remontée à l'expert** (jamais auto) ;
   - `OBSOLETE` → `deprecate_document` / `link_blocks(..., SUPERSEDES)`.
5. **Staging** — `mem_stage_changes({ workspace, sourceId, changes })` → `MemIngestion` PROPOSED.
6. **Revue humaine** — `mem_ingestion_get` ; l'expert accepte/rejette par op.
7. **Application** — `mem_apply_ingestion` : transactionnel, une `MemRevision` par op,
   liée à l'`ingestionId`. Réversible via les snapshots `before/after`.

> Garde-fou anti-dérive : si deux ingestions touchent la même section de façons
> subtilement incompatibles, le `MemIngestion` PROPOSED rend la collision visible
> avant application. À faible volume on est loin du régime où ça oscille.

---

## 7. Format de bloc & recherche

- **`MemBlock.content` = markdown.** Pas de Portable Text : ses *marks* inline servent
  l'édition rich-text humaine ; ici les annotations (source/comment/lien) s'attachent
  au bloc entier, en relationnel — bien plus requêtable (SQL/Drizzle) et facile à
  raisonner pour un agent. Échappatoire si un jour on veut de l'annotation intra-bloc
  au span : réduire encore la taille des blocs avant de réintroduire un format riche.
- **Recherche** : full-text par bloc. Postgres `search_vector tsvector` + config
  `french_unaccent` maintenue par **trigger** (hors DSL ORM → requête SQL brute ;
  extension `unaccent` requise). Embeddings / recherche sémantique = v2 éventuel, pas v1.

---

## 8. Topologie & accès

*(Section réécrite post-implémentation — la topologie de départ, Fastify + Logto +
tuls.me, a été remplacée. Détails opérationnels : `docs/deployment-edge.md` et
`docs/access-control.md`.)*

- **Service autonome** : `/data/projects/memento`, repo git propre, déploiement propre.
  **Runtime unique = Supabase Edge Functions (Deno)** : une function `mcp` (serveur MCP,
  SDK officiel `@modelcontextprotocol/sdk`, Streamable HTTP stateless) et une function
  `api` (miroir REST lecture pour le viewer), toutes deux minces au-dessus d'une seule
  couche service (`supabase/functions/_shared/`). Viewer Vue 3 (`app/`) — pas d'UI
  WYSIWYG d'édition de blocs en v1.
- **Auth : Supabase Auth** — serveur OAuth 2.1 + DCR ; la function MCP est resource
  server RFC 9728 (PRM, `WWW-Authenticate`, vérif JWKS ES256). (Logto abandonné en
  cours de route — Supabase couvre OAuth + DB + Edge d'un seul tenant.)
- **Accès** : orgs/memberships maison (`mem_orgs`, `mem_memberships`), un workspace
  appartient à une org, rôles admin/curator/member. Une org = un périmètre de partage.
- **Interop** : agent → connecteur MCP (claude.ai, Claude Code). Jamais de partage de DB ;
  l'API Data Supabase (PostgREST) est **coupée**, tout passe par les functions.
- **Déploiement** : prod `mento.cc` — front **Cloudflare Pages** (la SPA + Pages
  Functions qui proxient `/mcp`·`/api`·`/.well-known` → Supabase), backend Supabase.
  Auto-deploy sur push `main`. Reprise éventuelle de `mento.cc` + du slot MCP global de
  l'ancien Mento : ultérieure.

---

## 9. Amorçage du corpus (optionnel, découplé)

Pour ne pas démarrer vide, on peut **importer** du contenu existant — c'est une *entrée
de données*, pas un couplage. Premier workspace visé : **Demo KB** (docs Arnaud :
créativité, stratégie chinoise, éco-conception). Un importateur autonome :

1. Récupère les docs (markdown déjà converti, ou PDF → markdown via un convertisseur) ;
   chaque fichier source → une `MemSource` (`kind=FILE`/`URL` + `citation`).
2. Découpe le markdown (un parseur de headings type `parseOutline` convient) :
   headings → `MemSection`, paragraphes → `MemBlock` (`PROSE` par défaut).
3. Attache la `MemSource` aux blocs (sourcing initial grossier, raffiné ensuite à la
   main / par la boucle).

C'est un **amorçage**, pas une vérité figée. Toute autre source (notes, retours
d'expérience, exports d'un autre projet) entre par le même chemin.

---

## 10. Ordre de construction — **tous lots livrés** ✅

- **Lot 0 — Cadrage** ✅ (2026-05-29) : projet Memento, stack, multi-workspace.
- **Lot 1 — Socle lecture** ✅ : tables + amorçage + `mem_workspaces/doctrine/section/document/block/search`.
- **Lot 2 — Écriture curée** ✅ : `add_document` (2 portes), blocs, sources, `verify_block`, `MemRevision`.
- **Lot 3 — Maillage & annotation** ✅ : `link_blocks/unlink`, `comment/resolve_comment`.
- **Lot 4 — Restructuration** ✅ : sections (create/rename/delete/split/merge), `move_documents`, `reorder`, `deprecate_document` — composites avec `dryRun`.
- **Lot 5 — Boucle d'ingestion** ✅ : `MemIngestion` + `stage_changes/ingestion_get/list/apply/reject`.

S'y sont ajoutés hors lots : portage **Supabase Edge** + prod `mento.cc`,
contrôle d'accès orgs/memberships, KB par défaut (`mem_use_workspace`), gestion de KB
(doctrine/update/archive/create + `mem_orgs`), UI admin (membres, invitation par lien,
création de KB), viewer enrichi (journal, ingestions, liens/sources/commentaires).

**La suite se planifie dans les issues GitHub du repo** (#7 rôle proposer, #8 connecteur
claude.ai, #9 onboarding JB, #10 recherche sémantique, #11 `mem_sources`, #12–#14 doc).

---

## 11. Décisions — tranchées et ouvertes

**Tranchées (implémentées)** :
- **Profondeur max des sections = 3** (enforce dans `_shared/restructure.ts`).
- **Une section peut être à la fois parent et porteuse de documents** : oui.
- **Auth** : Logto → **Supabase Auth OAuth 2.1 + DCR** (§8, `docs/deployment-edge.md`).
- **Accès** : Organizations Logto → **orgs/memberships maison** ; une org = un périmètre
  de partage (`docs/access-control.md`).
- **Granularité KB = périmètre de partage** (une par mission/client + perso), pas par
  repo, pas de KB générale.

**Ouvertes** :
- **Taxonomie initiale des sections** (workspace Demo KB) = décision **Arnaud/Cyril**,
  pas technique. Le schéma ne câble **aucune** catégorie : l'arbre est de la donnée.
- **Vocabulaire `MemBlockType`** : à valider contre un vrai corpus avant de figer l'enum
  — risque de sur- ou sous-typer.
- **Reprise de `mento.cc`** + du slot MCP global de l'ancien Mento : à planifier.
- **Recherche sémantique / embeddings** : issue #10.
- **Rôle « proposer »** (imposer la boucle propose-valide aux agents) : issue #7.
