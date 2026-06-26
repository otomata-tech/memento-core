# ADR 0004 — Bootstrap adaptatif : préambule per-sub + `load` calibré au budget

- **Statut** : Proposé
- **Date** : 2026-06-26
- **Contexte amont** : ADR 0001 (page-centré) · ADR 0003 (1 base/org) · issue #26 (mem_brief — bootstrap en un appel)
- **Décideurs** : Alexis Laporte

## Contexte

Le **cold-start** — ce que l'agent reçoit en début de conversation pour se repérer dans Memento — est aujourd'hui **aveugle à la taille de la KB**, aux deux bouts :

1. **Les `instructions`** (préambule MCP servi à l'`initialize`) sont une **constante** (`V3_INSTRUCTIONS`) : même texte pour une KB vide et une KB de 50 000 pages.
2. **`load`** rend une **profondeur fixe** (`depth`, défaut 2, clampé 1-4), **uniforme** sur tout l'arbre, **descriptions toujours incluses**. Or la taille de l'index par profondeur est **imprévisible** : sur 4 As (330 pages) l'index seul passe de **~428 tokens (depth 3) à ~11 000 (depth 4)** — un ×25 entre deux crans, parce que l'arbre est étroit en haut puis explose en largeur. `depth` est donc un **mauvais bouton** : on ne contrôle pas le poids livré.

Deux faits empiriques cadrent la décision :

- **Variance énorme, peu de données au sommet.** Sur les 15 bases migrées : médiane ~5 pages / **< 300 tokens d'index** ; la plupart < 1,5k ; un seul outlier (4 As, 17k tokens full). Les vrais gros (org de 5k–50k pages) **n'existent pas encore dans les données** → on ne peut pas *tuner* une heuristique dessus.
- **claude.ai re-`initialize` souvent.** Mesuré (sonde serveur, 2026-06-26) : **8 `initialize` en ~55 min**, y compris après un idle de 30 min, sans « nouvelle conversation » à chaque fois. Le handshake **n'est pas caché au branchement** : les `instructions` sont re-lues fréquemment. En revanche, **pas en cours de conversation active** (les `tools/call` d'un même échange réutilisent l'init initial).

## Décision

Le bootstrap devient **adaptatif**, sur **deux leviers coordonnés**, autour d'un principe unique : **l'index est une carte, pas le territoire** — calibré à un **budget de tokens**, jamais à une profondeur.

### 1. Préambule per-sub, calculé à l'`initialize`

`initialize` est **authentifié** (le serveur connaît le `sub`) → les `instructions` cessent d'être une constante et sont **dérivées de l'utilisateur et de sa KB** :

- **KB petite** (index sous un seuil, cf. points ouverts) : on **plie la carte entière dans le préambule** — guide + arbre. L'agent a tout **sans appeler `load`** → cold-start **à zéro round-trip** (réalise #26 pour les petites KB, qui sont la majorité).
- **KB grosse** : préambule **lean** + nudge taillé (« KB de N pages — appelle `load` avec un budget, commence en surface, descends à la demande »).
- **Compte vide / nouveau** : message d'onboarding.

Contraintes préservées (lot découvrabilité #66) : **client-agnostique** (« l'agent », jamais « Claude »), **aucun backtick**, et **rester court**.

### 2. `load` piloté par un budget (pas une profondeur)

`load` accepte un **budget de tokens** (ou un palier nommé `compact`/`standard`/`full`) à la place — ou en plus — de `depth`. Le serveur renvoie **l'index le plus dense qui tient sous le budget** :

- **expansion breadth-first**, on descend tant que ça rentre, ordonné par **saillance** (position, récence, nb de mentions) ;
- **compteurs comme substituts** : une branche élaguée affiche `+N pages` → l'agent sait qu'il y a là-dessous et peut re-`load`/`get` cette branche ;
- **descriptions élidées en profondeur** : titres seuls au-delà de la surface (le levier #1 sur les tokens — descriptions = ~114 chars/nœud en moyenne).

→ **taille d'index prévisible quelle que soit la forme de la KB**, et **robuste aux tailles jamais vues** : le **budget EST la spec**, on ne calibre pas sur des données qu'on n'a pas.

## Pourquoi cette forme

- **Budget-driven > heuristique de profondeur** : correct *par construction* à toute échelle, sans données au sommet. Une heuristique `depth` exigerait des KB de 50k pages qu'on n'aura qu'après coup.
- **Préambule dynamique viable** : `initialize` est authentifié **et** re-tiré fréquemment (mesuré) → une modulation per-sub atterrit chez l'agent en **minutes**, pas au prochain re-add du connecteur.
- **Le bon endroit pour le budget** : pour les petites KB (90 % des cas), plier la carte dans le préambule **supprime l'appel `load`** — le cold-start coûte un aller-retour de moins. C'est seulement la longue traîne des grosses KB qui a besoin du `load` budgété.
- **Avant `initialize`, rien n'est connaissable** du serveur (le core MCP ne définit aucun manifeste pré-handshake ; les `.well-known` ne servent qu'à l'OAuth). Donc le préambule de l'`initialize` est le **point d'entrée le plus précoce** de toute description — il n'y a pas d'amont où injecter.

## Conséquences

- **+** Cold-start **calibré et prévisible** ; **moins cher** pour le cas courant (petite KB = carte pliée, zéro appel `load`).
- **+** Robuste aux tailles de KB **non encore observées**.
- **+** Tranche aussi le wart d'amorçage : sur une seule/petite base, l'agent n'a même pas à résoudre un UUID de base.
- **−** Le préambule devient **dynamique** → une lecture DB par `initialize` (fréquent !). À **cacher côté serveur** (etag de la base) pour ne pas requêter à chaque handshake.
- **−** **Staleness en cours de conversation** : claude.ai réutilise l'init du début → un changement n'est pas vu *au milieu* d'un échange (il l'est à la connexion suivante, fréquente). Inhérent au cache MCP, acceptable.
- **−** Deux chemins de code (builder de préambule + algo budget de `load`) + une **fonction de saillance** à régler.
- **−** Changement de **contrat** de `load` (`mcp-contract.v3.ts`) : `depth?` → `budget?`/palier. Migration : garder `depth` en alias déprécié le temps de la bascule.

## Points ouverts à trancher (non bloquants pour la décision)

| Élément | Piste de départ |
|---|---|
| **Seuil « petite KB »** (carte pliée dans le préambule) | ~1,5–2k tokens d'index full |
| **Budget par défaut de `load`** | ~2k tokens (palier `standard`) |
| **Palier nommé vs budget chiffré** | exposer des **paliers** (`compact`/`standard`/`full`) à l'agent (ergonomie) ; budget brut en option |
| **Fonction de saillance** (ordre d'expansion) | position, récence, nb de mentions |
| **Cache serveur du préambule** | par `etag` de base, pour absorber la fréquence des `initialize` |
| **Org de session vs base au moment de l'`initialize`** | le serveur connaît le `sub`, pas une base « choisie » → préambule au niveau compte (base unique/maison spécifique ; multi-base = résumer + nudger) |

## Validation empirique consignée (2026-06-26)

- Spread des 15 bases migrées : médiane ~5 pages / < 300 tokens d'index ; outlier 4 As 17k full.
- 4 As, index seul par profondeur : depth 1 ≈ 52 tok · 2 ≈ 111 · 3 ≈ 428 · **4 ≈ 11 000** (×25, d'où « `depth` = mauvais bouton »).
- Cadence des handshakes claude.ai : 8 `initialize` / 55 min (sonde serveur, table jetable) → instructions re-lues souvent ⇒ préambule dynamique exploitable.
