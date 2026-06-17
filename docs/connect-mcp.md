# Connecter Memento (MCP)

Guide pour brancher la base de connaissance Memento à un client MCP (claude.ai, Claude
Desktop, Claude Code, autres). Le serveur est **distant, authentifié OAuth** — rien à
installer en local.

## Prérequis

1. **Un compte** sur `me.mento.cc` (login Supabase). Si tu as reçu un **lien
   d'invitation**, ouvre-le une fois : il crée ton compte et te connecte au viewer.
2. **Être membre d'une organisation** qui possède au moins une base (workspace). Sinon le
   serveur se connecte mais `mem_workspaces` renvoie une liste vide (accès à rien). Demande
   à un admin de t'ajouter (UI `/admin` → Inviter).

Point de terminaison MCP : **`https://mcp.mento.cc/mcp`**

## claude.ai (web) / Claude Desktop

1. **Réglages → Connecteurs → Ajouter un connecteur personnalisé**.
2. Colle l'URL `https://mcp.mento.cc/mcp`. Nom : `Memento`.
3. Valide → une fenêtre OAuth s'ouvre :
   - le client s'enregistre tout seul (DCR) ;
   - **connecte-toi** avec ton compte Memento (Supabase) ;
   - **page de consentement** → « Autoriser ».
4. Le connecteur passe « connecté ». Les outils `mem_*` apparaissent.

> Si tu ne vois pas de nouveaux verbes après une mise à jour serveur : **déconnecte /
> reconnecte** le connecteur (la liste d'outils est figée à la connexion).

## Claude Code (CLI)

```bash
claude mcp add memento https://mcp.mento.cc/mcp --transport http
```
Au premier appel, Claude Code ouvre le navigateur pour l'OAuth (login Supabase + consentement),
puis mémorise le token. Vérifier : `claude mcp list`.

## Autres clients (Mistral Le Chat, ChatGPT)

Le serveur est **agnostique au client** : tout client MCP gérant un serveur distant en
**OAuth 2.1 + DCR** (RFC 7591) et **RFC 9728** (`401` + `WWW-Authenticate` → PRM) se branche
sans rien changer côté Memento. Validé live le **2026-06-17** sur Le Chat *et* ChatGPT.

### Mistral Le Chat

1. **Connectors** → **+ Add Connector** → onglet **Custom MCP Connector**.
2. **Server URL** : `https://mcp.mento.cc/mcp` — nom : `Memento` → **Connect**.
3. Auto-détection de l'auth → flux OAuth Supabase (login + consentement).

- Feature **admin-only** ; sur Free/Pro/Student l'owner du compte est admin par défaut.
- **Pas de dynamic tool discovery** : liste d'outils figée à la connexion → après une MAJ
  serveur, déconnecter/reconnecter pour voir les nouveaux verbes.

### ChatGPT (Developer Mode)

1. **Settings → Apps & Connectors → Advanced settings → Developer Mode** (ON).
2. **Create** → **MCP Server URL** : `https://mcp.mento.cc/mcp`, **Authentication** : OAuth.
3. Flux OAuth Supabase → activer les outils `mem_*` dans la fiche du connecteur.

- Plans **Plus / Pro / Business / Enterprise / Edu**, **web only**.
- **DCR supporté** (pas seulement CIMD) ; **pas d'exigence `search`/`fetch`** — tous les
  verbes `mem_*` passent. Les **write actions** sont confirmées par défaut (colle à la
  boucle propose-valide).
- Le toggle *« Enforce CSP in developer mode »* ne concerne que les **MCP Apps à UI rendue**
  (widgets/iframes) → **sans impact** sur Memento (tools-only, retours JSON/texte).

> Risque résiduel commun à ces deux clients : le rendu de la page de consentement Supabase
> (`/oauth/consent`) dans leur webview. Si l'OAuth tourne en rond, c'est là qu'il faut creuser
> — côté Memento (redirect/consent), pas côté protocole.

## Premiers pas (doctrine-first)

Le serveur est **sans état** : on nomme toujours la base. Flux recommandé que l'agent suit :

1. `mem_workspaces` — liste les bases auxquelles **tu** as accès.
2. `mem_doctrine({ workspace: "<slug>" })` — la carte : préambule + arbre des sections + conventions.
3. Drill : `mem_section` / `mem_document` / `mem_block` (par `id` ou `path` — le `path` commence
   par le slug de la base), ou `mem_search({ workspace, q })` (plein-texte par bloc).

Exemple de prompt : « Avec Memento, donne-moi la carte de la base `demo`, puis ce que dit
le critère HAS 1.7.4, sourcé. »

## Écriture & boucle propose-valide

Réservé aux rôles **admin / curator** de l'org. L'agent ne mute jamais en aveugle : il
**propose** un change-set (`mem_stage_changes`) → un humain le revoit (vue *Ingestions* du
viewer ou `mem_ingestion_get`) → applique (`mem_apply_ingestion`) ou rejette. Les
contradictions ne sont jamais appliquées automatiquement.

## Dépannage

| Symptôme | Cause / fix |
|---|---|
| Connexion OK mais `mem_workspaces` vide | Pas membre d'une org propriétaire d'une base → demande un accès. |
| `401` / re-demande de login | Token expiré → relancer le flux OAuth (reconnecter le connecteur). |
| « Accès refusé à ce workspace » | La base appartient à une org dont tu n'es pas membre. |
| Écriture en `isError` « réservé admin/curator » | Ton rôle est `member` (lecture seule). |
| Nouveaux verbes absents | Liste d'outils figée → déconnecter / reconnecter le connecteur. |

## Repères techniques (pour l'admin)

- Auth : Supabase OAuth 2.1 + DCR ; la function est resource server RFC 9728 (PRM sur
  `/.well-known/oauth-protected-resource`, vérif JWKS ES256). Détails : `docs/deployment-edge.md`.
- Accès par workspace via orgs/memberships. Gestion : UI `/admin` ou CLI `npm run admin`.
  Voir `docs/access-control.md`.
