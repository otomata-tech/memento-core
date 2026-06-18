<script setup lang="ts">
// Organization page — Bases / Members / Settings tabs (/org/:org/:tab).
// All state comes from the URL (deep-link); the org is switched from the bar (AppShell).
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api, type AdminOrg } from "../api";
import AppShell from "../components/AppShell.vue";
import SharePanel from "../components/SharePanel.vue";

const route = useRoute();
const router = useRouter();

const orgs = ref<AdminOrg[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const notice = ref<string | null>(null);
const invite = ref<{ email: string; link: string } | null>(null);
const copied = ref(false);

const memberForm = ref({ email: "", role: "member" });
const wsForm = ref({ name: "", summary: "" });
// "Share" panel per base (issue #60) — SharePanel component, opened on click.
const accessOpen = ref<string | null>(null);
// Transfer target per base (slug → destination org chosen in the select).
const moveTo = ref<Record<string, string>>({});

const slug = computed(() => String(route.params.org ?? ""));
const tab = computed(() => String(route.params.tab ?? "bases"));
const org = computed<AdminOrg | null>(() => orgs.value.find((o) => o.slug === slug.value) ?? null);
const isAdmin = computed(() => org.value?.myRole === "admin");
/** Possible destination orgs for a transfer (admin on both sides). */
const moveTargets = computed(() => orgs.value.filter((o) => o.myRole === "admin" && o.slug !== slug.value));
/** Reference base for the shell nav: a base of THIS org. */
const shellWs = computed(() => org.value?.workspaces[0]?.slug ?? "");

async function load() {
  loading.value = true; error.value = null;
  try {
    orgs.value = (await api.admin.orgs()).orgs;
    if (slug.value && !org.value) error.value = `Organization "${slug.value}" not found (or you are not a member).`;
  } catch (e) { error.value = String(e instanceof Error ? e.message : e); }
  finally { loading.value = false; }
}

function flash(msg: string) { notice.value = msg; error.value = null; }
function fail(e: unknown) { error.value = String(e instanceof Error ? e.message : e); notice.value = null; }

async function addMember() {
  if (!org.value || !memberForm.value.email.trim()) return;
  invite.value = null;
  try {
    const r = await api.admin.invite(org.value.slug, memberForm.value.email.trim(), memberForm.value.role);
    if (r.emailSent) flash(`Invitation emailed to ${r.email} (${r.role})`);
    else if (r.provisioned && r.inviteLink) invite.value = { email: r.email, link: r.inviteLink };
    else flash(`${r.email} → ${org.value.name} (${r.role})`);
    memberForm.value.email = "";
    await load();
  } catch (e) { fail(e); }
}

async function resendInvite(m: { email: string | null }) {
  if (!org.value || !m.email) return;
  try { await api.admin.resendInvite(org.value.slug, m.email); flash(`Sign-in email resent to ${m.email}`); }
  catch (e) { fail(e); }
}

async function showInviteLink(m: { email: string | null }) {
  if (!org.value || !m.email) return;
  try { invite.value = await api.admin.inviteLink(org.value.slug, m.email); notice.value = null; error.value = null; }
  catch (e) { fail(e); }
}

async function removeMember(m: { userId: string; email: string | null }) {
  if (!org.value) return;
  if (!confirm(`Remove ${m.email ?? m.userId} from ${org.value.name}?`)) return;
  try { await api.admin.removeMember(org.value.slug, m.userId); flash(`${m.email ?? m.userId} removed`); await load(); }
  catch (e) { fail(e); }
}

async function createWorkspace() {
  if (!org.value || !wsForm.value.name.trim()) return;
  try {
    const w = await api.admin.createWorkspace(org.value.slug, wsForm.value.name.trim(), wsForm.value.summary.trim());
    flash(`Base "${w.name}" created (${w.slug})`);
    wsForm.value = { name: "", summary: "" };
    await load();
  } catch (e) { fail(e); }
}

function toggleAccess(wsSlug: string) {
  accessOpen.value = accessOpen.value === wsSlug ? null : wsSlug;
}

async function archiveWorkspace(wsSlug: string) {
  if (!confirm(`Archive base "${wsSlug}"? It will be hidden (reversible).`)) return;
  try { await api.archiveWorkspace(wsSlug, true); flash(`Base "${wsSlug}" archived`); await load(); }
  catch (e) { fail(e); }
}

async function transferWorkspace(wsSlug: string) {
  const dest = moveTo.value[wsSlug];
  if (!org.value || !dest) return;
  if (!confirm(`Move "${wsSlug}" to ${dest}? Members of ${org.value.name} will lose access.`)) return;
  try {
    const r = await api.admin.transferWorkspace(dest, wsSlug);
    flash(`Base "${r.workspace}" transferred to ${r.toOrg}`);
    delete moveTo.value[wsSlug];
    await load();
  } catch (e) { fail(e); }
}

async function deleteOrg() {
  if (!org.value) return;
  if (!confirm(`Delete the empty organization "${org.value.name}"?`)) return;
  try {
    await api.admin.deleteOrg(org.value.slug);
    const next = orgs.value.find((o) => o.slug !== slug.value);
    await router.replace(next ? `/org/${next.slug}/bases` : "/");
  } catch (e) { fail(e); }
}

async function copyLink() {
  if (!invite.value) return;
  try { await navigator.clipboard.writeText(invite.value.link); copied.value = true; setTimeout(() => (copied.value = false), 1500); }
  catch { /* clipboard unavailable: manual copy */ }
}

watch(() => route.params.org, () => { notice.value = null; invite.value = null; });
load();
</script>

<template>
  <AppShell page="org" :ws="shellWs" :org="slug">
    <template #crumbs><span><b>{{ tab }}</b></span></template>

    <div class="scroll">
    <main class="content">
      <p v-if="error" class="msg err">{{ error }}</p>
      <p v-if="notice" class="msg ok">{{ notice }}</p>

      <div v-if="invite" class="invite">
        <div class="invite-head">
          Account created for <strong>{{ invite.email }}</strong> — send them this link (valid once):
          <button class="close" @click="invite = null" title="Close">×</button>
        </div>
        <div class="invite-link">
          <input :value="invite.link" readonly @focus="(e) => (e.target as HTMLInputElement).select()" />
          <button @click="copyLink">{{ copied ? "✓ copied" : "Copy" }}</button>
        </div>
        <p class="muted small">Single-use link — link previews (WhatsApp, Slack…) can consume it. Prefer email when possible.</p>
      </div>

      <p v-if="loading" class="muted">Loading…</p>

      <template v-if="!loading && org">
        <header class="org-head">
          <h1>{{ org.name }} <span class="slug">{{ org.slug }}</span></h1>
          <span class="badge" :class="org.myRole ?? ''">{{ org.myRole }}</span>
        </header>

        <nav class="tabs">
          <router-link :to="`/org/${org.slug}/bases`" :class="{ on: tab === 'bases' }">Bases</router-link>
          <router-link :to="`/org/${org.slug}/membres`" :class="{ on: tab === 'membres' }">Members</router-link>
          <router-link :to="`/org/${org.slug}/reglages`" :class="{ on: tab === 'reglages' }">Settings</router-link>
        </nav>

        <!-- ── Bases ─────────────────────────────────────────────────────── -->
        <section v-if="tab === 'bases'" class="card">
          <table v-if="org.workspaces.length" class="members">
            <thead><tr><th>Base</th><th></th><th v-if="isAdmin"></th></tr></thead>
            <tbody>
              <template v-for="w in org.workspaces" :key="w.slug">
              <tr>
                <td>
                  <router-link :to="`/w/${w.slug}`"><b>{{ w.name }}</b></router-link>
                  <span class="slug">{{ w.slug }}</span>
                  <span v-if="w.visibility === 'private'" class="vis-badge" title="Access by invitation only">🔒 private</span>
                  <span v-else-if="w.visibility === 'public'" class="vis-badge" title="Readable and searchable by everyone, no account needed">🌐 public</span>
                </td>
                <td class="right">
                  <button v-if="isAdmin" class="link-action" @click="toggleAccess(w.slug)">{{ accessOpen === w.slug ? "close" : "share" }}</button>
                  <router-link :to="`/w/${w.slug}`" class="link-action">open</router-link>
                </td>
                <td v-if="isAdmin" class="right actions">
                  <template v-if="moveTargets.length">
                    <select v-model="moveTo[w.slug]" class="mini">
                      <option disabled value="">move to…</option>
                      <option v-for="t in moveTargets" :key="t.slug" :value="t.slug">{{ t.name }}</option>
                    </select>
                    <button v-if="moveTo[w.slug]" class="link-action" @click="transferWorkspace(w.slug)">⇄ move</button>
                  </template>
                  <button class="link-danger" @click="archiveWorkspace(w.slug)">archive</button>
                </td>
              </tr>
              <tr v-if="accessOpen === w.slug">
                <td :colspan="isAdmin ? 3 : 2" class="access-panel">
                  <SharePanel :workspace="w.slug" @changed="load" />
                </td>
              </tr>
              </template>
            </tbody>
          </table>
          <p v-else class="muted">No base in this organization.</p>

          <form v-if="isAdmin" class="add" @submit.prevent="createWorkspace">
            <input v-model="wsForm.name" type="text" placeholder="Name of the new base" required />
            <input v-model="wsForm.summary" type="text" placeholder="Summary (optional)" />
            <button type="submit">Create a base</button>
          </form>
        </section>

        <!-- ── Members ───────────────────────────────────────────────────── -->
        <section v-if="tab === 'membres'" class="card">
          <table class="members">
            <thead><tr><th>Member</th><th>Role</th><th></th></tr></thead>
            <tbody>
              <tr v-for="m in org.members" :key="m.userId">
                <td>
                  {{ m.email ?? m.userId.slice(0, 12) + "…" }}
                  <span v-if="m.pending" class="badge pending" title="Account never signed in">pending</span>
                </td>
                <td><span class="badge" :class="m.role">{{ m.role }}</span></td>
                <td class="right">
                  <template v-if="isAdmin">
                    <button v-if="m.pending" class="link-action" title="Resend the invitation email" @click="resendInvite(m)">resend</button>
                    <button v-if="m.pending" class="link-action" title="Link to share by hand" @click="showInviteLink(m)">link</button>
                    <button class="link-danger" @click="removeMember(m)">remove</button>
                  </template>
                </td>
              </tr>
            </tbody>
          </table>

          <form v-if="isAdmin" class="add" @submit.prevent="addMember">
            <input v-model="memberForm.email" type="email" placeholder="email@exemple.com" required />
            <select v-model="memberForm.role">
              <option value="member">member (read)</option>
              <option value="curator">curator (write)</option>
              <option value="admin">admin</option>
            </select>
            <button type="submit">Invite / update</button>
          </form>
          <p v-else class="muted small">Read-only — restricted to org admins.</p>
        </section>

        <!-- ── Settings ──────────────────────────────────────────────────── -->
        <section v-if="tab === 'reglages'" class="card">
          <dl class="meta">
            <dt>Name</dt><dd>{{ org.name }}</dd>
            <dt>Slug</dt><dd class="slug">{{ org.slug }}</dd>
            <dt>My role</dt><dd><span class="badge" :class="org.myRole ?? ''">{{ org.myRole }}</span></dd>
            <dt>Scope</dt><dd class="muted">An org = a sharing scope (mission, client, personal). Members see all its bases.</dd>
          </dl>
          <div v-if="isAdmin" class="danger-zone">
            <template v-if="!org.workspaces.length && org.members.length <= 1">
              <button class="link-danger" @click="deleteOrg">Delete this organization (empty)</button>
            </template>
            <p v-else class="muted small">Deletion is only possible once the org has no base and no other member.</p>
          </div>
        </section>
      </template>
    </main>
    </div>
  </AppShell>
</template>

<style scoped>
/* Editorial: no radius. Lives in AppShell (.ed). */
.content { padding: 24px; max-width: 760px; width: 100%; margin: 0 auto; }
.org-head { display: flex; align-items: center; gap: 12px; margin-bottom: 4px; }
.org-head h1 { font-family: var(--font-display); font-size: 22px; margin: 0; }
.slug { font-family: var(--font-mono); font-size: 12px; color: var(--color-faint); margin-left: 6px; }
.tabs { display: flex; gap: 18px; border-bottom: 1px solid var(--color-hair); margin: 14px 0 18px; }
.tabs a { padding: 8px 2px; font-size: 14px; color: var(--color-mute); text-decoration: none; border-bottom: 2px solid transparent; margin-bottom: -1px; }
.tabs a.on { color: var(--color-ink); border-bottom-color: var(--color-ink); font-weight: 600; }
.card { background: var(--color-surface); border: 1px solid var(--color-hair); padding: 18px 20px; margin-bottom: 18px; }
.vis-badge { margin-left: 8px; font-size: 11px; color: var(--color-mute); border: 1px solid var(--color-hair); padding: 1px 6px; }
.access-panel { background: var(--color-bg); padding: 12px 16px !important; }
.members { width: 100%; border-collapse: collapse; font-size: 14px; }
.members th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--color-mute); padding: 4px 6px; border-bottom: 1px solid var(--color-hair); }
.members td { padding: 8px 6px; border-bottom: 1px solid var(--color-hair-soft); }
.right { text-align: right; }
.actions { white-space: nowrap; }
.badge { font-family: var(--font-mono); font-size: 10px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; padding: 2px 7px; background: var(--color-paper-2); color: var(--color-ink-soft); }
.badge.admin { background: var(--color-primary-soft); color: var(--color-primary-ink); }
.badge.curator { background: var(--color-strong-bg); color: var(--color-strong-ink); }
.link-action { border: none; background: none; color: var(--color-ink-soft); cursor: pointer; font-size: 13px; }
.link-danger { border: none; background: none; color: var(--color-weak-mid); cursor: pointer; font-size: 13px; }
.add { display: flex; gap: 8px; margin-top: 14px; flex-wrap: wrap; }
.add input { flex: 1; min-width: 200px; border: 1px solid var(--color-hair); background: var(--color-bg); padding: 8px 10px; font: inherit; }
.add input:focus { outline: 2px solid var(--color-primary); border-color: var(--color-primary); }
.add select { border: 1px solid var(--color-hair); background: var(--color-bg); padding: 8px; font: inherit; }
.add button { border: 1px solid var(--color-ink); background: var(--color-ink); color: var(--color-bg); padding: 8px 14px; font-weight: 600; cursor: pointer; }
.mini { border: 1px solid var(--color-hair); background: var(--color-bg); padding: 4px 6px; font: inherit; font-size: 12px; }
.invite { border: 1px solid var(--color-primary); background: var(--color-primary-soft); padding: 14px 16px; margin-bottom: 18px; }
.invite-head { font-size: 14px; color: var(--color-primary-ink); position: relative; padding-right: 24px; }
.invite-head .close { position: absolute; top: -4px; right: -4px; border: none; background: none; color: var(--color-primary-ink); font-size: 20px; cursor: pointer; padding: 0 6px; }
.invite-link { display: flex; gap: 8px; margin: 10px 0 4px; }
.invite-link input { flex: 1; border: 1px solid var(--color-hair); background: var(--color-surface); padding: 8px 10px; font-family: var(--font-mono); font-size: 12px; }
.invite-link button { border: 1px solid var(--color-ink); background: var(--color-ink); color: var(--color-bg); padding: 8px 14px; font-weight: 600; cursor: pointer; white-space: nowrap; }
.msg { padding: 10px 14px; font-size: 14px; }
.msg.err { background: var(--color-weak-bg); color: var(--color-weak-ink); }
.msg.ok { background: var(--color-strong-bg); color: var(--color-strong-ink); }
.muted { color: var(--color-mute); }
.small { font-size: 13px; }
.meta { display: grid; grid-template-columns: 110px 1fr; gap: 8px 14px; font-size: 14px; margin: 0; }
.meta dt { color: var(--color-mute); font-size: 12px; text-transform: uppercase; letter-spacing: .04em; padding-top: 2px; }
.meta dd { margin: 0; }
.danger-zone { border-top: 1px solid var(--color-hair); margin-top: 18px; padding-top: 14px; }
</style>
