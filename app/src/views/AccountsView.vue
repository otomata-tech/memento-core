<script setup lang="ts">
// Vue PLATEFORME — inventaire de tous les comptes auth (le signup est ouvert :
// des comptes peuvent exister sans appartenir à aucune org). Réservée aux
// opérateurs plateforme (MEMENTO_PLATFORM_ADMINS) ; les autres voient le refus.
import { onMounted, ref } from "vue";
import { api, type PlatformAccount } from "../api";
import AppShell from "../components/AppShell.vue";

const accounts = ref<PlatformAccount[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);

const day = (s: string | null) => (s ? s.slice(0, 10) : "—");

onMounted(async () => {
  try {
    accounts.value = (await api.admin.accounts()).accounts;
  } catch (e) { error.value = String(e instanceof Error ? e.message : e); }
  finally { loading.value = false; }
});
</script>

<template>
  <AppShell page="comptes" ws="">
    <div class="accounts">
      <h1>Comptes</h1>
      <p class="muted">
        Tous les comptes de la plateforme — y compris ceux qui n'appartiennent à aucune
        org (le signup est ouvert ; sans org, un compte ne voit aucune base).
      </p>
      <p v-if="loading" class="muted">Chargement…</p>
      <p v-else-if="error" class="muted err">{{ error }}</p>
      <table v-else>
        <thead>
          <tr><th>Email</th><th>Créé</th><th>Dernier login</th><th>Via</th><th>Orgs (rôle)</th></tr>
        </thead>
        <tbody>
          <tr v-for="a in accounts" :key="a.id" :class="{ orphan: !a.orgs }">
            <td>{{ a.email }}</td>
            <td>{{ day(a.createdAt) }}</td>
            <td>{{ day(a.lastSignInAt) }}</td>
            <td>{{ a.provider ?? "—" }}</td>
            <td>{{ a.orgs ?? "aucune" }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </AppShell>
</template>

<style scoped>
.accounts { max-width: 880px; margin: 0 auto; padding: 24px; }
.accounts h1 { font-size: 22px; margin: 0 0 6px; }
table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 14px; }
th { text-align: left; font-size: 12px; color: var(--color-mute); font-weight: 600; padding: 6px 10px; border-bottom: 1px solid var(--color-hair); }
td { padding: 8px 10px; border-bottom: 1px solid var(--color-hair); }
tr.orphan td { color: var(--color-mute); }
tr.orphan td:first-child { color: inherit; }
.err { color: var(--color-danger, #b00); }
</style>
