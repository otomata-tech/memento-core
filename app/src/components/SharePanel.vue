<script setup lang="ts">
// Panneau « Partager » d'une base — le geste de partage de premier ordre (à la
// Notion). Réutilisé par le popover de la barre (AppShell) et la page org/Bases.
// Gating serveur : admins de l'org propriétaire (les autres voient le refus).
import { onMounted, ref } from "vue";
import { api, type WorkspaceAccess, type WorkspaceGrant } from "../api";

const props = defineProps<{ workspace: string }>();
const emit = defineEmits<{ changed: [] }>();

const access = ref<WorkspaceAccess | null>(null);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const inviteLink = ref<string | null>(null);
const copied = ref<string | null>(null); // "link" | "url"
const form = ref({ email: "", role: "member" });
const baseUrl = `${location.origin}/w/${props.workspace}`;

async function reload() {
  try { access.value = await api.grants(props.workspace); }
  catch (e) { error.value = String(e instanceof Error ? e.message : e); }
}

async function changeVisibility(e: Event) {
  if (!access.value) return;
  const visibility = (e.target as HTMLSelectElement).value as "org" | "private" | "public";
  error.value = notice.value = null;
  try {
    await api.setVisibility(props.workspace, visibility);
    await reload();
    notice.value = visibility === "private"
      ? "Base privée — seules les personnes invitées y accèdent."
      : visibility === "public"
        ? "Base publique — accessible et cherchable par tout le monde (galerie publique + recherche), sans compte."
        : `Base visible par tous les membres de ${access.value.orgName ?? "l'organisation"}.`;
    emit("changed");
  } catch (e) { error.value = String(e instanceof Error ? e.message : e); }
}

async function invite() {
  if (!form.value.email.trim()) return;
  error.value = notice.value = inviteLink.value = null;
  try {
    const r = await api.grant(props.workspace, form.value.email.trim(), form.value.role);
    if (r.emailSent) notice.value = `Invitation envoyée à ${r.email}`;
    else if (r.provisioned && r.inviteLink) inviteLink.value = r.inviteLink;
    else notice.value = `${r.email} a maintenant accès (${r.role === "curator" ? "écriture" : "lecture"})`;
    form.value.email = "";
    await reload();
    emit("changed");
  } catch (e) { error.value = String(e instanceof Error ? e.message : e); }
}

async function changeRole(g: WorkspaceGrant, e: Event) {
  if (!g.email) return;
  try {
    await api.grant(props.workspace, g.email, (e.target as HTMLSelectElement).value);
    await reload();
  } catch (err) { error.value = String(err instanceof Error ? err.message : err); }
}

async function revoke(g: WorkspaceGrant) {
  if (!confirm(`Retirer l'accès de ${g.email ?? g.userId} à « ${props.workspace} » ?`)) return;
  try { await api.revokeGrant(props.workspace, g.userId); await reload(); emit("changed"); }
  catch (e) { error.value = String(e instanceof Error ? e.message : e); }
}

async function copy(text: string, what: string) {
  try { await navigator.clipboard.writeText(text); copied.value = what; setTimeout(() => (copied.value = null), 1500); }
  catch { /* copie manuelle */ }
}

onMounted(reload);
</script>

<template>
  <div class="share">
    <p v-if="error" class="msg err">{{ error }}</p>
    <p v-if="!access && !error" class="muted">Chargement…</p>
    <template v-if="access">
      <div class="row">
        <label>Qui peut accéder</label>
        <select :value="access.visibility" @change="changeVisibility">
          <option value="org">Tous les membres de {{ access.orgName ?? "l'organisation" }}</option>
          <option value="private">Seulement les personnes invitées</option>
          <option value="public">Public — tout le monde (galerie + recherche)</option>
        </select>
      </div>

      <div v-if="access.visibility === 'public'" class="pubnote">
        🌐 Publique — lisible et cherchable par tous, sans compte. Apparaît dans la
        <a href="/public" target="_blank" rel="noopener">galerie publique</a>.
      </div>

      <form class="inviteform" @submit.prevent="invite">
        <input v-model="form.email" type="email" placeholder="Inviter par email (externe bienvenu)" required />
        <select v-model="form.role">
          <option value="member">lecture</option>
          <option value="curator">écriture</option>
        </select>
        <button type="submit">Inviter</button>
      </form>
      <p v-if="notice" class="msg ok">{{ notice }}</p>
      <div v-if="inviteLink" class="linkbox">
        <span>Compte créé — transmets ce lien (usage unique, évite les previews) :</span>
        <div class="linkrow">
          <input :value="inviteLink" readonly @focus="(e) => (e.target as HTMLInputElement).select()" />
          <button @click="copy(inviteLink!, 'link')">{{ copied === "link" ? "✓" : "Copier" }}</button>
        </div>
      </div>

      <div class="people">
        <div v-for="g in access.grants" :key="g.userId" class="person">
          <span class="who">{{ g.email ?? g.userId }} <em v-if="g.pending">pending</em></span>
          <select :value="g.role" @change="changeRole(g, $event)" :disabled="!g.email">
            <option value="member">lecture</option>
            <option value="curator">écriture</option>
          </select>
          <button class="rm" @click="revoke(g)" title="Retirer l'accès">×</button>
        </div>
        <div v-for="m in access.inherited" :key="`i-${m.userId}`" class="person inh">
          <span class="who">{{ m.email ?? m.userId }} <em v-if="m.pending">pending</em></span>
          <span class="via">{{ m.role }} · via {{ access.orgName ?? access.org }}</span>
        </div>
        <p v-if="!access.grants.length && !access.inherited.length" class="muted small">Personne n'a accès — invite quelqu'un.</p>
      </div>

      <button class="copyurl" @click="copy(baseUrl, 'url')">
        {{ copied === "url" ? "✓ lien copié" : "Copier le lien de la base" }}
      </button>
    </template>
  </div>
</template>

<style scoped>
.share { width: 360px; max-width: 90vw; font-size: 13px; display: flex; flex-direction: column; gap: 10px; }
.row { display: flex; flex-direction: column; gap: 4px; }
.row label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--color-mute); }
select, input { padding: 6px 8px; border: 1px solid var(--color-hair); background: var(--color-bg); font-family: inherit; font-size: 13px; }
.inviteform { display: flex; gap: 6px; }
.inviteform input { flex: 1; min-width: 0; }
.inviteform button { border: 1px solid var(--color-ink); background: var(--color-ink); color: var(--color-bg); padding: 6px 12px; font-weight: 600; }
.people { display: flex; flex-direction: column; }
.person { display: flex; align-items: center; gap: 8px; padding: 5px 0; border-bottom: 1px solid var(--color-hair-soft); }
.person .who { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.person .who em { font-style: normal; font-size: 11px; color: var(--color-mute); }
.person.inh .via { font-size: 12px; color: var(--color-mute); }
.person select { font-size: 12px; padding: 2px 4px; }
.rm { background: none; border: none; color: var(--color-mute); font-size: 15px; cursor: pointer; }
.rm:hover { color: var(--color-danger, #b00); }
.copyurl { background: none; border: 1px solid var(--color-hair); padding: 6px; color: var(--color-ink); cursor: pointer; }
.msg { margin: 0; font-size: 12px; }
.msg.err { color: var(--color-danger, #b00); }
.msg.ok { color: var(--color-primary-ink, #060); }
.linkbox { font-size: 12px; color: var(--color-mute); display: flex; flex-direction: column; gap: 4px; }
.linkrow { display: flex; gap: 6px; }
.linkrow input { flex: 1; min-width: 0; font-size: 11px; }
.small { font-size: 12px; }
.pubnote { font-size: 12px; color: var(--color-mute); line-height: 1.5; background: var(--color-hair-soft, #f4f1ea); padding: 8px 10px; border-radius: 4px; }
.pubnote a { color: var(--color-ink); text-decoration: underline; }
</style>
