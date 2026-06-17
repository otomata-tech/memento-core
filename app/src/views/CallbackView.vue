<script setup lang="ts">
/**
 * Atterrissage des liens OTP (invitation, magic link). Arrivée via `type=invite`
 * (compte provisionné SANS mot de passe) → proposer d'en définir un, sinon
 * l'utilisateur ne pourra se reconnecter que par email. Skippable.
 */
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { supabase, arrivedVia } from "../auth";

const router = useRouter();
const askPassword = ref(false);
const password = ref("");
const confirm = ref("");
const busy = ref(false);
const error = ref("");

onMounted(async () => {
  const { data } = await supabase.auth.getSession(); // detectSessionInUrl a déjà posé la session
  if (!data.session) { router.replace("/login"); return; }
  if (arrivedVia === "invite" || arrivedVia === "recovery") askPassword.value = true;
  else router.replace("/");
});

async function setPassword() {
  if (password.value.length < 8) { error.value = "8 caractères minimum."; return; }
  if (password.value !== confirm.value) { error.value = "Les deux saisies diffèrent."; return; }
  busy.value = true; error.value = "";
  const { error: e } = await supabase.auth.updateUser({ password: password.value });
  busy.value = false;
  if (e) { error.value = e.message; return; }
  router.replace("/");
}
</script>

<template>
  <div v-if="askPassword" class="cb-wrap">
    <div class="cb-card">
      <div class="brand">Memento</div>
      <h1 class="title">Bienvenue !</h1>
      <p class="muted">
        Ton accès est actif. Choisis un mot de passe pour pouvoir te reconnecter
        (sinon, connexion par lien email uniquement).
      </p>
      <form @submit.prevent="setPassword">
        <input v-model="password" type="password" placeholder="mot de passe (8+ caractères)" autocomplete="new-password" required class="field" />
        <input v-model="confirm" type="password" placeholder="confirme le mot de passe" autocomplete="new-password" required class="field" />
        <div class="actions">
          <button type="submit" :disabled="busy">{{ busy ? "…" : "Définir et continuer" }}</button>
          <button type="button" class="ghost" @click="router.replace('/')">Plus tard</button>
        </div>
      </form>
      <p v-if="error" class="muted err">{{ error }}</p>
    </div>
  </div>
  <p v-else class="muted" style="padding:24px">Connexion en cours…</p>
</template>

<style scoped>
.cb-wrap { display: flex; min-height: 100vh; align-items: center; justify-content: center; padding: 24px; }
.cb-card { width: 100%; max-width: 420px; border: 1px solid var(--color-hair); background: var(--color-surface); padding: 28px; }
.cb-card .brand { font-family: var(--font-display); font-weight: 700; font-size: 16px; color: var(--color-primary-ink); margin-bottom: 18px; }
.cb-card .title { font-size: 22px; margin: 0 0 8px; }
.field { display: block; width: 100%; padding: 9px 11px; margin-top: 10px; border: 1px solid var(--color-hair); background: var(--color-bg); font-family: inherit; }
.field:focus { outline: 2px solid var(--color-primary); }
button { border: 1px solid var(--color-ink); background: var(--color-ink); color: var(--color-bg); padding: 9px 16px; font-weight: 600; font-size: 14px; cursor: pointer; }
button.ghost { background: none; color: var(--color-ink); }
.actions { display: flex; gap: 10px; margin-top: 20px; }
.muted { color: var(--color-mute); }
.err { color: var(--color-danger, #b00); margin-top: 12px; }
</style>
