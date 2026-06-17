<script setup lang="ts">
/**
 * Écran de consentement OAuth 2.1 (serveur OAuth Supabase).
 * Supabase redirige le client MCP (Claude) ici avec ?authorization_id=...
 * Flow : login (si besoin) → getAuthorizationDetails → approve/deny → redirect_url.
 * L'URL me.mento.cc/oauth/consent (site_url) est dans les Redirect URLs Supabase.
 */
import { ref, onMounted } from "vue";
import { supabase, signInWithGoogle } from "../auth";

const state = ref<"loading" | "login" | "consent" | "error">("loading");
const error = ref("");
const email = ref("");
const password = ref("");
const sent = ref(false);
const busy = ref(false);
const details = ref<any>(null);
let authorizationId = "";

function consentUrl() {
  return `${window.location.origin}/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`;
}

function oauthApi(): any {
  const o = (supabase.auth as any).oauth;
  if (!o?.getAuthorizationDetails) {
    throw new Error("@supabase/supabase-js trop ancien (pas de support OAuth server) — mettre à jour.");
  }
  return o;
}

async function load() {
  authorizationId = new URLSearchParams(window.location.search).get("authorization_id") || "";
  if (!authorizationId) { state.value = "error"; error.value = "authorization_id manquant"; return; }

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { state.value = "login"; return; }

  try {
    const { data, error: e } = await oauthApi().getAuthorizationDetails(authorizationId);
    if (e) throw e;
    if (!("authorization_id" in data)) { window.location.href = data.redirect_url; return; } // déjà consenti
    details.value = data;
    state.value = "consent";
  } catch (e: any) { state.value = "error"; error.value = e.message || String(e); }
}

async function decide(approve: boolean) {
  try {
    const api = oauthApi();
    const { data, error: e } = approve
      ? await api.approveAuthorization(authorizationId)
      : await api.denyAuthorization(authorizationId);
    if (e) throw e;
    window.location.href = data.redirect_url;
  } catch (e: any) { state.value = "error"; error.value = e.message || String(e); }
}

async function signInPassword() {
  busy.value = true; error.value = "";
  const { error: e } = await supabase.auth.signInWithPassword({ email: email.value, password: password.value });
  busy.value = false;
  if (e) { error.value = e.message; return; }
  await load(); // session posée → enchaîne sur le consentement
}

async function signInOtp() {
  await supabase.auth.signInWithOtp({ email: email.value, options: { emailRedirectTo: consentUrl() } });
  sent.value = true;
}

async function signInGoogle() {
  const e = await signInWithGoogle(consentUrl());
  if (e) { state.value = "error"; error.value = e; }
}

onMounted(load);
</script>

<template>
  <div class="consent-wrap">
    <div class="consent-card">
      <div class="brand">Memento</div>

      <p v-if="state === 'loading'" class="muted">Chargement…</p>

      <template v-else-if="state === 'login'">
        <h1 class="title">Connexion requise</h1>
        <p v-if="sent" class="muted">Lien envoyé à {{ email }} — clique-le, tu reviendras ici pour autoriser.</p>
        <template v-else>
          <p class="muted">Connecte-toi pour autoriser l'application.</p>
          <button type="button" class="google" @click="signInGoogle">Continuer avec Google</button>
          <div class="sep"><span>ou</span></div>
          <form @submit.prevent="signInPassword">
            <input v-model="email" type="email" placeholder="ton.email@…" required class="field" />
            <input v-model="password" type="password" placeholder="mot de passe" required class="field" />
            <div class="actions">
              <button type="submit" :disabled="busy">{{ busy ? "…" : "Se connecter" }}</button>
              <button type="button" class="ghost" @click="signInOtp">Lien par email</button>
            </div>
          </form>
        </template>
      </template>

      <template v-else-if="state === 'consent'">
        <h1 class="title">Autoriser {{ details?.client?.name || "cette application" }}</h1>
        <p class="muted">demande l'accès à votre base de connaissance Memento :</p>
        <ul v-if="details?.scope" class="scopes">
          <li v-for="s in String(details.scope).split(' ')" :key="s"><code>{{ s }}</code></li>
        </ul>
        <p class="muted small">Redirection : {{ details?.redirect_uri }}</p>
        <div class="actions">
          <button @click="decide(true)">Autoriser</button>
          <button class="ghost" @click="decide(false)">Refuser</button>
        </div>
      </template>

      <template v-else>
        <h1 class="title">Erreur</h1>
        <p class="muted">{{ error }}</p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.consent-wrap { display: flex; min-height: 100vh; align-items: center; justify-content: center; padding: 24px; }
.consent-card { width: 100%; max-width: 420px; border: 1px solid var(--color-hair); background: var(--color-surface); padding: 28px; }
.consent-card .brand { font-family: var(--font-display); font-weight: 700; font-size: 16px; color: var(--color-primary-ink); margin-bottom: 18px; }
.consent-card .title { font-size: 22px; margin: 0 0 8px; }
.field { display: block; width: 100%; padding: 9px 11px; margin-top: 10px; border: 1px solid var(--color-hair); background: var(--color-bg); font-family: inherit; }
.field:focus { outline: 2px solid var(--color-primary); }
button { border: 1px solid var(--color-ink); background: var(--color-ink); color: var(--color-bg); padding: 9px 16px; font-weight: 600; font-size: 14px; }
button.ghost { background: none; color: var(--color-ink); }
button.google { width: 100%; margin-top: 16px; background: none; color: var(--color-ink); border: 1px solid var(--color-hair); }
.sep { display: flex; align-items: center; gap: 10px; margin: 16px 0 4px; color: var(--color-mute); font-size: 12px; }
.sep::before, .sep::after { content: ""; flex: 1; height: 1px; background: var(--color-hair); }
.actions { display: flex; gap: 10px; margin-top: 20px; }
.scopes { margin: 10px 0; padding-left: 18px; }
.scopes code { font-family: var(--font-mono); font-size: 13px; }
.small { font-size: 12px; }
</style>
