<script setup lang="ts">
const SKILLS = [
  {
    cmd: "/memento",
    title: "Capture dispatcher",
    body: "Entry point. Reflects on the session, auto-detects the project's preferred layer (the “Memento KB:” line in CLAUDE.md), routes to the right layers, and watches size, suggesting a cleanup if needed.",
  },
  {
    cmd: "/memento:files",
    title: "Project files",
    body: "Versioned capture in the repo: the project map (CLAUDE.md) and the per-concept detail (docs/). What serves the repo, in the repo.",
  },
  {
    cmd: "/memento:memory",
    title: "Local memory",
    body: "Preferences, recurring feedback, profile, external references and pointers to the KB. Single-machine layer: for lightweight cross-project notes and indexes, not durable data.",
  },
  {
    cmd: "/memento:distant",
    title: "Push to the KB",
    body: "Pushes selected facts to the KB: doctrine first, proposal (fact → section → source), then stage → explicit GO → apply. Never a blind write.",
  },
  {
    cmd: "/memento:refactor",
    title: "Deep cleanup",
    body: "On-demand layer maintenance: deduplication, eviction of stale state, extraction to docs/, size budgets (CLAUDE.md ≤ 200 lines).",
  },
  {
    cmd: "/memento:install",
    title: "Setup",
    body: "Checks the connector (OAuth on first call), sets the default KB, writes the project → workspace mapping into the project's CLAUDE.md.",
  },
];

const INSTALL = `{
  "extraKnownMarketplaces": {
    "memento-dev": {
      "source": { "source": "github", "repo": "otomata-tech/memento-plugin" }
    }
  },
  "enabledPlugins": { "memento@memento-dev": true }
}`;
</script>

<template>
  <div class="plugin">
    <header class="topbar">
      <router-link to="/" class="brand brand-link">Memento<small>mento.cc</small></router-link>
      <nav class="hnav">
        <router-link to="/">Home</router-link>
        <router-link to="/login" class="cta">Sign in</router-link>
      </nav>
    </header>

    <main>
      <!-- Connect (client-agnostic) — target of the app's “Connect (MCP)” menu -->
      <section class="sect" id="connecter">
        <p class="eyebrow">Connect</p>
        <h2>Wire up an MCP client</h2>
        <p class="lede">
          Memento is a <b>remote MCP server</b>, authenticated via OAuth. Connect any
          compatible client to the endpoint — your account (and its sharing scope) follows the connection,
          nothing to install locally.
        </p>
        <pre class="code">https://mcp.mento.cc/mcp</pre>
        <ul class="clients">
          <li>
            <b>claude.ai · ChatGPT · Mistral Le Chat</b> — Settings → Connectors → “Add a
            custom connector” → paste the URL above → authenticate (OAuth on first use).
          </li>
          <li>
            <b>Claude Code (CLI)</b> — <code>claude mcp add memento https://mcp.mento.cc/mcp --transport http</code>,
            OAuth on first call. Or install the <b>plugin</b> (below): it wires up the connector and the skills.
          </li>
        </ul>
      </section>

      <section class="hero">
        <p class="eyebrow">Claude Code plugin</p>
        <h1>Session memory,<br />all the way to the shared KB.</h1>
        <p class="lede">
          The <code>memento</code> plugin gives Claude Code a layered memory
          discipline: what serves the repo goes in the repo, what concerns you goes in global
          memory, and the <b>domain facts others will need to know</b> — humans
          or agents — are proposed to the Memento KB. The MCP connector is bundled:
          installing the plugin is enough.
        </p>
      </section>

      <!-- Skills -->
      <section class="sect">
        <p class="eyebrow">Six skills</p>
        <div class="skills">
          <article v-for="s in SKILLS" :key="s.cmd" class="skill">
            <code class="cmd">{{ s.cmd }}</code>
            <h2>{{ s.title }}</h2>
            <p>{{ s.body }}</p>
          </article>
        </div>
      </section>

      <!-- Routing doctrine -->
      <section class="sect">
        <p class="eyebrow">Where what goes</p>
        <table class="route">
          <tbody>
            <tr>
              <td class="what">Repo gotchas, commands, conventions</td>
              <td class="where">project <code>CLAUDE.md</code></td>
            </tr>
            <tr>
              <td class="what">User preferences and feedback</td>
              <td class="where">global memory</td>
            </tr>
            <tr>
              <td class="what">Mission fact, business rule, decision that sets doctrine</td>
              <td class="where"><b>Memento KB</b> — sourced block (citation + attachable ref)</td>
            </tr>
          </tbody>
        </table>
        <p class="note">
          KB granularity: one <b>sharing scope</b> per KB (one per
          mission/client, one personal) — not one KB per repo, no catch-all.
          Only <code>/memento:distant</code> writes to the KB, via the
          propose-validate loop, after selection and an explicit GO.
        </p>
      </section>

      <!-- Installation -->
      <section class="sect">
        <p class="eyebrow">Installation</p>
        <ol class="steps">
          <li>
            <b>Access.</b> The KBs are private (orgs/roles): you must have been invited —
            <a href="mailto:hello@mento.cc">request access</a>.
          </li>
          <li>
            <b>Declare the plugin</b> in <code>~/.claude/settings.json</code>:
            <pre class="code">{{ INSTALL }}</pre>
          </li>
          <li>
            <b>New session</b>: the skills appear, the connector
            <code>https://mcp.mento.cc/mcp</code> is added. The first call of a
            <code>mem_*</code> tool opens the OAuth flow (login + consent).
          </li>
          <li>
            <b>In a project</b>: <code>/memento:install</code> wires up the project's KB,
            then <code>/memento</code> at the end of the session.
          </li>
        </ol>
      </section>
    </main>

    <footer class="foot">
      <span class="brand-foot">Memento</span>
      <span class="muted">an <a href="https://otomata.tech">Otomata</a> project</span>
    </footer>
  </div>
</template>

<style scoped>
.plugin { min-height: 100%; display: flex; flex-direction: column; background: var(--color-bg); }
main { flex: 1; width: 100%; max-width: 880px; margin: 0 auto; padding: 0 24px; }

.brand-link { color: var(--color-ink); }
.brand-link:hover { text-decoration: none; }
.hnav { margin-left: auto; display: flex; align-items: center; gap: 18px; }
.hnav a { font-size: 13.5px; font-weight: 600; color: var(--color-mute); }
.hnav a:hover { color: var(--color-ink); text-decoration: none; }
.hnav a.cta { border: 1px solid var(--color-ink); color: var(--color-ink); padding: 6px 14px; }
.hnav a.cta:hover { background: var(--color-ink); color: var(--color-bg); }

.hero { padding: 64px 0 44px; }
.hero h1 {
  font-family: var(--font-display); font-weight: 650; margin: 14px 0 20px;
  font-size: clamp(34px, 5.5vw, 54px); line-height: 1.02; letter-spacing: -0.02em;
}
.lede { max-width: 640px; font-size: 16px; line-height: 1.65; color: var(--color-ink-soft); margin: 0; }
.lede b { color: var(--color-ink); }
.lede code, .note code, .steps code { font-family: var(--font-mono); font-size: 0.88em; background: var(--color-paper-2); padding: 1px 5px; }

#connecter { padding-top: 44px; }
#connecter h2 { font-family: var(--font-display); font-weight: 650; font-size: 26px; letter-spacing: -0.015em; margin: 12px 0 14px; }
.clients { margin: 16px 0 0; padding-left: 18px; display: flex; flex-direction: column; gap: 10px; }
.clients li { font-size: 14.5px; line-height: 1.6; color: var(--color-ink-soft); }
.clients b { color: var(--color-ink); }
.clients code { font-family: var(--font-mono); font-size: 0.88em; background: var(--color-paper-2); padding: 1px 5px; }

.sect { border-top: 1px solid var(--color-hair); padding: 36px 0 44px; }

.skills { margin-top: 20px; display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: var(--color-hair); border: 1px solid var(--color-hair); }
.skill { background: var(--color-surface); padding: 20px 20px 24px; }
.skill .cmd { font-family: var(--font-mono); font-size: 12px; color: var(--color-primary-ink); background: var(--color-primary-soft); padding: 2px 8px; }
.skill h2 { font-family: var(--font-display); font-size: 17px; font-weight: 650; margin: 12px 0 7px; }
.skill p { margin: 0; font-size: 13.5px; line-height: 1.6; color: var(--color-ink-soft); }

.route { margin-top: 20px; width: 100%; border-collapse: collapse; font-size: 14px; }
.route td { border: 1px solid var(--color-hair); padding: 10px 14px; background: var(--color-surface); }
.route .what { color: var(--color-ink-soft); }
.route .where { font-weight: 600; white-space: nowrap; }
.note { margin: 16px 0 0; font-size: 13.5px; line-height: 1.65; color: var(--color-ink-soft); max-width: 660px; }

.steps { margin: 20px 0 0; padding-left: 20px; display: flex; flex-direction: column; gap: 14px; font-size: 14.5px; line-height: 1.6; color: var(--color-ink-soft); }
.steps b { color: var(--color-ink); }
.code {
  font-family: var(--font-mono); font-size: 12.5px; line-height: 1.55;
  background: var(--color-ink); color: var(--color-bg);
  padding: 14px 16px; margin: 10px 0 0; overflow-x: auto;
}

.foot { border-top: 1px solid var(--color-hair); padding: 18px 24px; display: flex; align-items: baseline; gap: 14px; max-width: 880px; margin: 0 auto; width: 100%; }
.brand-foot { font-family: var(--font-display); font-weight: 700; font-size: 15px; }
.foot .muted { font-size: 12.5px; }

@media (max-width: 720px) {
  .skills { grid-template-columns: 1fr; }
  .route .where { white-space: normal; }
}
</style>
