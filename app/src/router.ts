import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";
import { supabase } from "./auth";
import { api } from "./api";
import { isSiteHost, APP_ORIGIN } from "./hosts";

const PREFERRED = "demo";
/** Dernière base ouverte (par device), mémorisée à chaque visite de /w/:ws. */
const LAST_WS_KEY = "memento:lastWorkspace";

/** /org et /admin (compat) → la page de la première org du caller. */
async function firstOrgRedirect() {
  try {
    const r = await api.admin.orgs();
    const slug = r.orgs[0]?.slug;
    if (slug) return `/org/${slug}/bases`;
  } catch { /* non loggé : le guard global renverra vers /login */ }
  return "/";
}

const routes: RouteRecordRaw[] = [
  // Accueil public (loggé : redirigé vers la KB par défaut par le guard)
  { path: "/", component: () => import("./views/HomeView.vue") },
  { path: "/plugin", component: () => import("./views/PluginView.vue") },
  // Galerie publique : annuaire + recherche des KB publiques (sans compte)
  { path: "/public", component: () => import("./views/PublicGalleryView.vue") },
  // Lire — le lecteur de blocs
  { path: "/w/:ws", component: () => import("./views/ReaderView.vue") },
  { path: "/w/:ws/doc/:id", component: () => import("./views/ReaderView.vue") },
  { path: "/w/:ws/search", component: () => import("./views/ReaderView.vue") },
  // Graphe
  { path: "/w/:ws/graph", component: () => import("./views/GraphView.vue") },
  { path: "/w/:ws/graph/:blockId", component: () => import("./views/GraphView.vue") },
  // Boucle
  { path: "/w/:ws/loop", component: () => import("./views/LoopView.vue") },
  // Organisations — gestion par org (onglets), org switchée depuis la barre
  { path: "/org/:org/:tab(bases|membres|reglages)", component: () => import("./views/OrgView.vue") },
  { path: "/org/:org", redirect: (to) => `/org/${to.params.org}/bases` },
  { path: "/org", beforeEnter: firstOrgRedirect, component: () => import("./views/HomeView.vue") },
  // Vue plateforme (gating serveur : MEMENTO_PLATFORM_ADMINS ; les autres voient le refus)
  { path: "/comptes", component: () => import("./views/AccountsView.vue") },
  { path: "/admin", beforeEnter: firstOrgRedirect, component: () => import("./views/HomeView.vue") }, // compat
  // Hors-éditorial
  { path: "/login", component: () => import("./views/LoginView.vue") },
  { path: "/oauth/consent", component: () => import("./views/ConsentView.vue") },
  { path: "/callback", component: () => import("./views/CallbackView.vue") },
  { path: "/:catchAll(.*)", redirect: "/" },
];

const router = createRouter({ history: createWebHistory(), routes });

// Pages publiques (gèrent leur propre auth) ; tout le reste exige une session.
// `/w/:ws…` est tolérant à l'anonyme : le viewer charge la KB et l'API ne sert que
// le périmètre `public` (sinon 403, affiché en place). L'édition reste gated (401).
const PUBLIC = new Set(["/", "/plugin", "/public", "/login", "/oauth/consent", "/callback"]);
// Sur le domaine vitrine (mento.cc), seules ces pages restent ; le reste part sur l'app.
const SITE_PUBLIC = new Set(["/", "/plugin"]);

/** Cible canonique d'un user loggé : sa dernière base ouverte, sinon son défaut. Null si l'API ne répond pas. */
async function defaultWorkspacePath(): Promise<string | null> {
  try {
    const [prefs, all] = await Promise.all([api.prefs(), api.workspaces()]);
    const last = localStorage.getItem(LAST_WS_KEY);
    // Priorité : dernière base ouverte (ce device) > défaut serveur > base repère > 1ʳᵉ accessible.
    const start = [last, prefs.defaultWorkspace, PREFERRED].find((s) => s && all.some((w) => w.slug === s))
      ?? all[0]?.slug;
    return start ? `/w/${start}` : null;
  } catch { return null; }
}

router.beforeEach(async (to) => {
  // mento.cc = vitrine : tout ce qui n'est pas page de site (login, viewer, oauth) → app.
  if (isSiteHost() && !SITE_PUBLIC.has(to.path)) {
    window.location.href = APP_ORIGIN + to.fullPath;
    return false;
  }
  // Pre-check sur "/" (hors vitrine) AVANT de monter la landing : getSession est
  // local (storage, pas de réseau) — loggé → KB par défaut, sinon → login.
  // La landing ne s'affiche que sur mento.cc ou si l'API est indisponible.
  if (to.path === "/" && !isSiteHost()) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return { path: "/login" };
    return (await defaultWorkspacePath()) ?? true;
  }
  if (PUBLIC.has(to.path)) return true;
  // Lecture d'une KB : tolérée sans session (le viewer/API gèrent l'accès — seul
  // le public passe en anonyme). Les autres routes (org, comptes…) exigent un login.
  // On mémorise au passage la dernière base ouverte (cible de la landing au prochain lancement).
  if (to.path.startsWith("/w/")) {
    if (typeof to.params.ws === "string") localStorage.setItem(LAST_WS_KEY, to.params.ws);
    return true;
  }
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { path: "/login", query: { redirect: to.fullPath } };
  return true;
});

export default router;
