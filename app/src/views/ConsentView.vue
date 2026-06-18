<script setup lang="ts">
/**
 * OAuth 2.1 consent screen (Supabase OAuth server).
 * Supabase redirects the MCP client (Claude) here with ?authorization_id=...
 * Flow: login (if needed) → getAuthorizationDetails → approve/deny → redirect_url.
 * The me.mento.cc/oauth/consent URL (site_url) is in the Supabase Redirect URLs.
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
    throw new Error("@supabase/supabase-js too old (no OAuth server support) — please update.");
  }
  return o;
}

async function load() {
  authorizationId = new URLSearchParams(window.location.search).get("authorization_id") || "";
  if (!authorizationId) { state.value = "error"; error.value = "authorization_id missing"; return; }

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { state.value = "login"; return; }

  try {
    const { data, error: e } = await oauthApi().getAuthorizationDetails(authorizationId);
    if (e) throw e;
    if (!("authorization_id" in data)) { window.location.href = data.redirect_url; return; } // already consented
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
  await load(); // session set → continue to consent
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

      <p v-if="state === 'loading'" class="muted">Loading…</p>

      <template v-else-if="state === 'login'">
        <h1 class="title">Sign-in required</h1>
        <p v-if="sent" class="muted">Link sent to {{ email }} — click it, you'll come back here to authorize.</p>
        <template v-else>
          <p class="muted">Sign in to authorize the application.</p>
          <button type="button" class="google" @click="signInGoogle">Continue with Google</button>
          <div class="sep"><span>or</span></div>
          <form @submit.prevent="signInPassword">
            <input v-model="email" type="email" placeholder="your.email@…" required class="field" />
            <input v-model="password" type="password" placeholder="password" required class="field" />
            <div class="actions">
              <button type="submit" :disabled="busy">{{ busy ? "…" : "Sign in" }}</button>
              <button type="button" class="ghost" @click="signInOtp">Email link</button>
            </div>
          </form>
        </template>
      </template>

      <template v-else-if="state === 'consent'">
        <h1 class="title">Authorize {{ details?.client?.name || "this application" }}</h1>
        <p class="muted">is requesting access to your Memento knowledge base (KB):</p>
        <ul v-if="details?.scope" class="scopes">
          <li v-for="s in String(details.scope).split(' ')" :key="s"><code>{{ s }}</code></li>
        </ul>
        <p class="muted small">Redirect: {{ details?.redirect_uri }}</p>
        <div class="actions">
          <button @click="decide(true)">Authorize</button>
          <button class="ghost" @click="decide(false)">Deny</button>
        </div>
      </template>

      <template v-else>
        <h1 class="title">Error</h1>
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
