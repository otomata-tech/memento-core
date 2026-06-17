# Contrôle d'accès

Qui accède à quelle KB. **Remplace la spec §2.7** (isolation par Organizations Logto, abandonnée avec la migration Supabase). **Refonte issue #60 (2026-06-12)** : l'org = tenant ; chaque KB porte son périmètre.

## Modèle

| Table | Rôle |
|---|---|
| `mem_orgs` (slug, name, personal_for) | un **tenant** (annuaire de membres) ; `personal_for` = org perso auto-provisionnée du user (sub, unique ; null = org normale) |
| `mem_memberships` (org_id, user_id, role) | user Supabase (`sub`) ↔ org, PK composite |
| `mem_workspaces.org_id` → `mem_orgs` | chaque KB appartient à UNE org (tenant) |
| `mem_workspaces.visibility` | `org` (membres de l'org, rôle d'org en défaut) \| `private` (grants seuls) \| `public` (lecture mondiale, anonyme incluse + galerie + recherche publique) |
| `mem_workspace_grants` (workspace_id, user_id, role) | accès explicite à UNE KB — élévation d'un membre, restriction via private, **guest externe** |

Règles (décision 2026-06-12) :
- **Accès au contenu** : rôle effectif = max(grant explicite, rôle d'org si `visibility=org`) — `effectiveRole()` dans `_shared/access.ts`. Granularité = workspace entier (pas de per-section, pas d'ACL fractales).
- **Gouvernance** (partager, visibility, archiver, transférer) = **admin de l'ORG propriétaire uniquement** (`assertWorkspaceAdmin`). Un grant ne vaut que `member` (lecture) ou `curator` (écriture) — jamais la gouvernance ; le transfert exige l'admin des DEUX orgs (anti-exfiltration).
- Une KB `private` : contenu invisible sans grant, mais son **existence** est visible des org-admins (sinon ingouvernable) — `myRole: null` dans la topologie. Le passage à private pose un grant `curator` au caller (il garde la lecture ; la gouvernance lui reste par l'org).
- Une KB `public` : **lecture (`member`) pour TOUS, anonyme inclus** (`effectiveRole` renvoie `member` même pour `sub === ""`). L'org propriétaire **garde son rôle d'org** (elle cure sa base publique) ; les grants élèvent toujours. C'est un sur-ensemble de `org` + lecture mondiale, jamais une rétrogradation. Les KB publiques d'autres orgs **n'entrent pas** dans « mes bases » (`accessibleWorkspaceIds`) — on les découvre par la **galerie publique** ou la **recherche publique**, ou en les épinglant (`mem_use_workspace`). L'écriture reste curator/admin → l'anonyme ne peut jamais muter.

### Surfaces publiques (sans auth)

- **Web viewer** : `api/index.ts` accepte les **GET anonymes** (token absent ⇒ `sub=""`) ; chaque route reste gardée par `assertAccess`, donc seul le périmètre `public` répond (sinon refus indistinct). Les mutations (POST/DELETE) exigent toujours un token valide. Routes ouvertes : `GET /public/workspaces` (annuaire) et `GET /public/search?q=` (recherche plein-texte sur toutes les KB publiques). Le front : route `/public` (`PublicGalleryView`), et `/w/:ws` lisible sans session (le journal de révisions est masqué à l'anonyme — pas de fuite d'identités).
- **MCP** : reste **authentifié** (OAuth). Un user connecté lit une KB publique en la nommant (slug / `mem_use_workspace`) — `effectiveRole` lui ouvre la lecture — ou la découvre via le verbe **`mem_public_search`** (recherche sur toutes les KB publiques, sans appartenance requise). On **n'expose pas** le MCP en anonyme.
- **Rate limit** : `search_public` (60/min) ne compte que les appels authentifiés (`sub` vide = no-op) ; l'anonyme est borné par le WAF Cloudflare/IP sur `me.mento.cc/api`.

**Org perso** : provisionnée au premier accès topologique (`ensurePersonalOrg`, idempotente, `personal_for` unique) — « Perso (xxx) », le user en est admin. Tout compte (guest compris) peut donc créer ses KB chez lui et les promouvoir plus tard (transfert = changement de tenant).

## Rôles

| role | lecture | écriture (Lot 2) |
|---|---|---|
| `member` | oui | non |
| `curator` | oui | oui |
| `admin` | oui | oui |

Rangs dans `supabase/functions/_shared/access.ts` (`ROLE_RANK`) ; écriture = rang ≥ curator.

## Enforcement

- `_shared/access.ts` : `effectiveRole(sub, wsId)`, `accessibleWorkspaceIds(sub)` (org-visibles ∪ grantées), `assertAccess(sub, ref, {write?})`, `assertWorkspaceAdmin(sub, slug)` (**admin de l'org propriétaire** — la gouvernance).
- `ref` résout le workspace ciblé depuis `{workspace}` (slug) | `{path}` | `{id, kind: section|document|block|ingestion|link|comment}`.
- Câblé dans `supabase/functions/mcp/index.ts` (`buildServer(sub)`, chaque verbe gardé) et `api/index.ts` (par route). `mem_workspaces` est filtré ; refus → 403 / `isError`.
- **Ops composites** : autoriser sur les entités RÉELLES résolues, pas un anchor fourni par le caller (cf. fix IDOR `mem_reorder`).
- Le `sub` vient du JWT vérifié (JWKS) par `authenticate()`.

## Partage : le périmètre se règle sur la KB (par l'org-admin)

Geste UI : bouton **Partager** dans la barre du viewer (org-admins) ou `/org/:slug/bases` → « partager » — composant `SharePanel.vue` (périmètre + « qui a accès » unifié grants/hérités + invitation). Verbe agent : `mem_grant`/`mem_grants`/`mem_set_visibility`.

- **Toute l'équipe** : `visibility=org` (défaut) — les membres de l'org accèdent avec leur rôle d'org (`inherited` dans `mem_grants`).
- **Sous-ensemble / perso dans l'équipe** : `visibility=private` + grants.
- **Externe (guest)** : `mem_grant({workspace, email, role: member|curator})` — compte provisionné + email d'invitation (même flux GoTrue que les membres d'org, atterrissage grant). Il voit la KB dans « Partagées avec moi » (menu org + `shared` de `mem_workspaces`), sans entrer dans l'org.
- **Ouvert à tous (public)** : `visibility=public` (`mem_set_visibility` ou l'option « Public » du SharePanel) — lecture/recherche par quiconque, sans compte (galerie `/public` + `mem_public_search`). Réservé à l'org-admin (gouvernance). L'écriture reste à l'org/curateurs.
- **Changer de tenant** (promouvoir une KB perso → équipe, remettre au client) : `mem_transfer_workspace` — admin des deux orgs. Le périmètre (visibility/grants) suit la KB.

## CLI admin — `npm run admin`

Cible la DB pointée par `DATABASE_URL` (Supabase direct pour la prod, local sinon). `email→sub` résolu via `auth.users` (présent seulement sur Supabase).

```bash
npm run admin -- whoami <email>                  # sub Supabase d'un email
npm run admin -- org-create <slug> <name>
npm run admin -- member-add <org-slug> <email|sub> <role>   # role = admin|curator|member
npm run admin -- ws-assign <ws-slug> <org-slug>
npm run admin -- list
```

Prod : exporte `DATABASE_URL` (URL Postgres directe de ton projet) depuis ton coffre à secrets, puis `npm --prefix server run admin -- <cmd>`.
Le CLI n'a pas de `member-remove`/`org-create-ws` → pour ces cas, script `tsx` ponctuel dans `server/` (importe `db` depuis `./src/db.js`).

## UI admin (SPA `/admin`) — `_shared/admin.ts`

**UI** : pages par org sur `/org/:slug/(bases|membres|reglages)` (onglets) ; org switchée
depuis la barre (menu près du compte : mes orgs, ⚙ gérer, + nouvelle organisation) ; le
sélecteur de bases ne montre que les bases de l'org courante ; `/admin` redirige (compat).
**API** — gère **orgs et membres** sans CLI : `GET /admin/orgs` (orgs du caller + membres + bases),
`POST /admin/orgs` (créer une org — le créateur devient admin ; `DELETE` si org vide),
`POST /admin/invite` (nouveau compte → **email d'invitation** GoTrue `/invite` via SMTP custom ;
repli lien à transmettre si l'envoi échoue), `POST /admin/invite/resend` (magic link) et
`/admin/invite/link` (lien manuel — ⚠ one-shot, les previews WhatsApp/Slack peuvent le consommer),
`DELETE /admin/members` (anti-lockout dernier admin), `POST /admin/workspaces` (créer une KB).
Membre **pending** = provisionné, `last_sign_in_at` null. À l'arrivée du lien (`/callback`,
`type=invite`), le viewer propose de **définir un mot de passe** (compte provisionné sans mdp —
sinon reconnexion par magic link uniquement). Édition doctrine/métadonnées/archivage :
`_shared/workspace_mgmt.ts` + `POST /workspace/doctrine|update|archive`. Tout gated org-admin
(orgs/membres/KB) ou curator (doctrine). SMTP/OTP : cf. `deployment-edge.md` § Auth.
