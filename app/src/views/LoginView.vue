<script setup lang="ts">
/**
 * Connexion au viewer Memento (email/mot de passe via Supabase).
 * Garde d'accès : le routeur redirige ici quand il n'y a pas de session.
 */
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { supabase, signInWithGoogle } from "../auth";

const route = useRoute();
const router = useRouter();
const email = ref("");
const password = ref("");
const busy = ref(false);
const sent = ref(false);
const error = ref("");
// Auto-connect : une session vivante existe déjà → pas de formulaire, on entre.
// (Sinon : re-login réflexe à chaque arrivée sur /login, sessions abandonnées en série.)
const checking = ref(true);
onMounted(async () => {
  const { data: { session } } = await supabase.auth.getSession();
  if (session) { router.replace(dest()); return; }
  checking.value = false;
});

function dest() {
  const r = route.query.redirect;
  // chemin relatif same-origin uniquement ("//host" = protocol-relative → externe)
  return typeof r === "string" && r.startsWith("/") && !r.startsWith("//") ? r : "/";
}

async function signInPassword() {
  busy.value = true; error.value = "";
  const { error: e } = await supabase.auth.signInWithPassword({ email: email.value, password: password.value });
  busy.value = false;
  if (e) { error.value = e.message; return; }
  router.replace(dest());
}

async function signInOtp() {
  error.value = "";
  const redirectTo = `${window.location.origin}/callback`;
  const { error: e } = await supabase.auth.signInWithOtp({ email: email.value, options: { emailRedirectTo: redirectTo } });
  if (e) { error.value = e.message; return; }
  sent.value = true;
}

async function signInGoogle() {
  error.value = "";
  const e = await signInWithGoogle(`${window.location.origin}/callback`);
  if (e) error.value = e; // sinon redirection vers Google
}
</script>

<template>
  <div class="login-wrap">
    <div class="login-card" v-if="!checking">
      <div class="brand">Memento</div>
      <h1 class="title">Connexion</h1>
      <p v-if="sent" class="muted">Lien envoyé à {{ email }} — clique-le pour te connecter.</p>
      <template v-else>
        <p class="muted">Connecte-toi pour consulter la base de connaissance.</p>
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
        <p v-if="error" class="muted err">{{ error }}</p>
      </template>
      <p class="pubentry"><router-link to="/public">Explorer les bases publiques →</router-link></p>
    </div>
  </div>
</template>

<style scoped>
.login-wrap { display: flex; min-height: 100vh; align-items: center; justify-content: center; padding: 24px; }
.login-card { width: 100%; max-width: 420px; border: 1px solid var(--color-hair); background: var(--color-surface); padding: 28px; }
.login-card .brand { font-family: var(--font-display); font-weight: 700; font-size: 16px; color: var(--color-primary-ink); margin-bottom: 18px; }
.login-card .title { font-size: 22px; margin: 0 0 8px; }
.field { display: block; width: 100%; padding: 9px 11px; margin-top: 10px; border: 1px solid var(--color-hair); background: var(--color-bg); font-family: inherit; }
.field:focus { outline: 2px solid var(--color-primary); }
button { border: 1px solid var(--color-ink); background: var(--color-ink); color: var(--color-bg); padding: 9px 16px; font-weight: 600; font-size: 14px; }
button.ghost { background: none; color: var(--color-ink); }
button.google { width: 100%; margin-top: 16px; background: none; color: var(--color-ink); border: 1px solid var(--color-hair); }
button.google:hover { background: var(--color-bg); }
.sep { display: flex; align-items: center; gap: 10px; margin: 16px 0 4px; color: var(--color-mute); font-size: 12px; }
.sep::before, .sep::after { content: ""; flex: 1; height: 1px; background: var(--color-hair); }
.actions { display: flex; gap: 10px; margin-top: 20px; }
.err { color: var(--color-danger, #b00); margin-top: 12px; }
.pubentry { margin: 20px 0 0; padding-top: 16px; border-top: 1px solid var(--color-hair); font-size: 13px; }
.pubentry a { color: var(--color-primary-ink, var(--color-ink)); text-decoration: none; }
.pubentry a:hover { text-decoration: underline; }
</style>
