<script setup lang="ts">
/**
 * Landing page for OTP links (invitation, magic link). Arriving via `type=invite`
 * (account provisioned WITHOUT a password) → offer to set one, otherwise
 * the user will only be able to sign back in by email. Skippable.
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
  const { data } = await supabase.auth.getSession(); // detectSessionInUrl has already set the session
  if (!data.session) { router.replace("/login"); return; }
  if (arrivedVia === "invite" || arrivedVia === "recovery") askPassword.value = true;
  else router.replace("/");
});

async function setPassword() {
  if (password.value.length < 8) { error.value = "8 characters minimum."; return; }
  if (password.value !== confirm.value) { error.value = "The two entries don't match."; return; }
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
      <h1 class="title">Welcome!</h1>
      <p class="muted">
        Your access is active. Choose a password so you can sign back in
        (otherwise, email link sign-in only).
      </p>
      <form @submit.prevent="setPassword">
        <input v-model="password" type="password" placeholder="password (8+ characters)" autocomplete="new-password" required class="field" />
        <input v-model="confirm" type="password" placeholder="confirm the password" autocomplete="new-password" required class="field" />
        <div class="actions">
          <button type="submit" :disabled="busy">{{ busy ? "…" : "Set and continue" }}</button>
          <button type="button" class="ghost" @click="router.replace('/')">Later</button>
        </div>
      </form>
      <p v-if="error" class="muted err">{{ error }}</p>
    </div>
  </div>
  <p v-else class="muted" style="padding:24px">Signing in…</p>
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
