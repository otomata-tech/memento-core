# Memento — les principes

*Memento mori, note tout.*

Memento est un **substrat de connaissance pour agents** : structuré, sourcé, vivant
et auditable, consommé via MCP. Ce document explique le *pourquoi* en quelques
minutes de lecture — sans détail d'implémentation. Pour le *comment* : la
[spec fondatrice](specs/knowledge-base.md) ; pour s'y connecter :
[connect-mcp](connect-mcp.md).

## Le problème

Un RAG documentaire stocke un **sac de documents** : on y retrouve des passages,
pas du savoir. Ce qui manque pour représenter un **savoir-faire** — concepts,
règles, exceptions, procédures — :

- savoir **d'où vient** chaque affirmation (et si elle est encore vraie) ;
- relier les morceaux entre eux (cette règle *dépend de* ce principe, *contredit*
  cette note plus ancienne) ;
- faire **évoluer** la base sans qu'elle se dégrade : qui a changé quoi, pourquoi,
  et avec quelle validation.

Les wikis le font pour les humains, mal pour les agents (pas de surface
programmable, pas d'atome adressable). Les vector stores le font pour la
similarité, pas pour la structure. Memento occupe ce créneau : **une base de
connaissance que des agents lisent ET maintiennent, sous contrôle humain.**

## Les six idées

### 1. Le bloc est l'atome

L'unité n'est ni le document ni le chunk : c'est le **bloc typé** (principe, règle,
exception, exemple, procédure, mise en garde, définition…). Chaque bloc est
adressable, et tout s'attache à lui : **sources** (d'où ça vient), **liens typés**
vers d'autres blocs (`references`, `depends_on`, `contradicts`, `supersedes`),
**commentaires**, **statut de vérification**. Un bloc qui aurait besoin de deux
sources pour deux affirmations doit être scindé : la maille fine est la garantie
d'auditabilité.

### 2. Contrainte en haut, liberté en bas

Chaque base (« workspace ») a une **épine dorsale** : un arbre de sections strict et
peu profond (≤ 3 niveaux), qui tient la carte mentale. En dessous, les documents
composent librement des blocs. La structure ne dérive pas, le contenu respire.

### 3. Doctrine-first

Un agent n'« aspire » jamais la base. Il commence par `mem_doctrine` : une **carte
compacte** (préambule de méta-instructions + arbre des sections + conventions),
toujours chargeable en contexte. Puis il fore — 2-3 sections, un document, un bloc.
Le serveur ne rend jamais de mur de texte non demandé.

### 4. Serveur bête, agent intelligent

Le serveur stocke, garantit les invariants (états invalides impossibles) et
journalise l'intention. **Aucun LLM côté serveur.** L'extraction de claims, la
classification, le jugement : c'est l'agent appelant. Corollaire :
**l'intelligence est à l'écriture, la lecture est déterministe** — on paie le coût
de structuration une fois, à l'entrée, et toutes les lectures suivantes sont
fiables et bon marché.

### 5. Propose-valide : rien n'entre sans revue

L'ingestion de savoir passe par une boucle : l'agent **propose** un change-set
classé (`CONFIRM` / `ENRICH` / `CONTRADICT` / `OBSOLETE`), un humain **revoit**,
puis le change-set est appliqué — transactionnellement, avec une révision motivée
par opération. Les **contradictions ne sont jamais auto-appliquées** : c'est le cas
précieux, celui qui mérite un arbitrage humain. Tout l'historique est un journal
d'intentions (« pourquoi » inclus), pas un diff brut.

### 6. Une base = un périmètre de partage

Le multi-workspace ne découpe pas par projet technique mais par **périmètre de
partage** : une base par mission/client, une base perso. L'accès suit : une
organisation possède la base, ses membres y accèdent selon leur rôle
(admin / curator / member). Pas de base « générale » fourre-tout.

## Ce que ça permet

- Un agent (claude.ai, Claude Code…) qui **consulte la doctrine avant d'agir** et
  cite ses sources au bloc près.
- Une veille qui **enrichit la base en continu** sans jamais l'écraser : chaque
  apport est proposé, classé, revu.
- Un savoir qui **survit aux réorganisations** : les sources restent ancrées aux
  blocs, le journal garde le pourquoi de chaque mutation.
- Plusieurs bases étanches (clients, perso) servies par **le même serveur**, le
  même compte, le même connecteur.

## Pour aller plus loin

- [Spec fondatrice](specs/knowledge-base.md) — modèle de données, surface MCP
  (39 verbes `mem_*`), invariants, boucle d'ingestion déroulée.
- [Recherche amont](research/) — mémoire & retrieval agentique (synthèse pédagogique
  + fiche sourcée) ; fonde « intelligence à l'écriture / lecture déterministe ».
- [Contrôle d'accès](access-control.md) — orgs, memberships, rôles.
- [Déploiement](deployment-edge.md) — topologie prod (Cloudflare Pages + Supabase Edge).
- [Se connecter](connect-mcp.md) — brancher Memento à claude.ai ou Claude Code.
