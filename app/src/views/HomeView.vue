<script setup lang="ts">
const FEATURES = [
  {
    img: "/illust-code.webp",
    title: "Sourced blocks, not chunks",
    body: "The atom is the typed block — principle, rule, exception, procedure. Each block carries its sources, its links (depends on, contradicts, supersedes), its verification status.",
  },
  {
    img: "/illust-access.webp",
    title: "One base per sharing scope",
    body: "One base per mission or client, one personal base — no catch-all. An organization owns the base; its members access it according to their role.",
  },
  {
    img: "/illust-startup.webp",
    title: "Built for agents, via MCP",
    body: "Agents read doctrine-first (a compact map, then drilling down) and write by proposing. No LLM server-side: reads are deterministic.",
  },
];

const IDEAS = [
  { n: "01", title: "The block is the atom", body: "Addressable, sourced, commented, linked — the fine grain is the guarantee of auditability." },
  { n: "02", title: "Constraint at the top, freedom at the bottom", body: "A strict, shallow backbone of sections; beneath it, documents breathe." },
  { n: "03", title: "Doctrine-first", body: "The agent loads the map, then drills down — never a wall of unrequested text." },
  { n: "04", title: "Dumb server, smart agent", body: "The intelligence is in the writing; reads are deterministic — you pay for structuring once." },
  { n: "05", title: "Propose-validate", body: "Nothing enters without review; contradictions are never auto-applied." },
  { n: "06", title: "Knowledge that survives", body: "Sources anchored to blocks, a log of intentions: the base evolves without degrading." },
];

const STEPS = [
  { n: "01", title: "Connect", body: "Any MCP client: claude.ai, Claude Code (bundled plugin), Mistral Le Chat, ChatGPT. Paste the connector URL, OAuth on first use." },
  { n: "02", title: "Read doctrine-first", body: "The agent loads the base's map — preamble, tree, conventions — then targets 2-3 sections." },
  { n: "03", title: "Propose", body: "New knowledge is proposed as a classified change-set: confirms, enriches, contradicts, deprecates." },
  { n: "04", title: "Validate", body: "You review, you apply. Every mutation is logged with its rationale." },
];
</script>

<template>
  <div class="home">
    <!-- Illustrated hero -->
    <section class="hero">
      <picture class="hero-bg">
        <img src="/illust-collab.webp" alt="" />
      </picture>
      <div class="hero-veil" />
      <header class="hero-top">
        <span class="hbrand">Memento<small>mento.cc</small></span>
        <nav class="hnav">
          <router-link to="/plugin">Claude Code Plugin</router-link>
          <router-link to="/login" class="cta">Sign in</router-link>
        </nav>
      </header>
      <div class="hero-body">
        <p class="eyebrow light">Knowledge substrate for agents · MCP</p>
        <h1>Memento mori,<br />note everything.</h1>
        <p class="lede">
          A knowledge base that agents <b>read and maintain</b>, under
          human control — structured, sourced, living and auditable.
        </p>
        <div class="actions">
          <router-link to="/login" class="btn-solar">Open the viewer</router-link>
          <router-link to="/plugin" class="btn-ghost">Connect Claude Code →</router-link>
        </div>
      </div>
    </section>

    <main>
      <!-- Illustrated features -->
      <section class="feats">
        <p class="eyebrow">What Memento does</p>
        <div class="fgrid">
          <article v-for="f in FEATURES" :key="f.title" class="feat">
            <div class="fimg"><img :src="f.img" alt="" loading="lazy" /></div>
            <h2>{{ f.title }}</h2>
            <p>{{ f.body }}</p>
          </article>
        </div>
      </section>

      <!-- Six ideas -->
      <section class="ideas">
        <p class="eyebrow">The six ideas</p>
        <div class="igrid">
          <article v-for="i in IDEAS" :key="i.n" class="idea">
            <span class="num">{{ i.n }}</span>
            <div>
              <h3>{{ i.title }}</h3>
              <p>{{ i.body }}</p>
            </div>
          </article>
        </div>
      </section>

      <!-- How it works -->
      <section class="steps">
        <p class="eyebrow">How it works</p>
        <div class="sgrid">
          <article v-for="s in STEPS" :key="s.n" class="step">
            <span class="snum">{{ s.n }}</span>
            <h3>{{ s.title }}</h3>
            <p>{{ s.body }}</p>
          </article>
        </div>
      </section>
    </main>

    <!-- Illustrated final CTA -->
    <section class="final">
      <picture class="final-bg"><img src="/illust-aerial.webp" alt="" loading="lazy" /></picture>
      <div class="final-veil" />
      <div class="final-body">
        <h2>Bases are private, access by invitation.</h2>
        <div class="actions">
          <router-link to="/login" class="btn-solar">Sign in</router-link>
          <a href="mailto:hello@mento.cc" class="btn-ghost">Request access</a>
        </div>
      </div>
    </section>

    <footer class="foot">
      <span class="brand-foot">Memento</span>
      <span class="muted">an <a href="https://otomata.tech">Otomata</a> project</span>
    </footer>
  </div>
</template>

<style scoped>
.home { min-height: 100%; display: flex; flex-direction: column; background: var(--color-bg); }
main { width: 100%; max-width: 1080px; margin: 0 auto; padding: 0 24px; }
.eyebrow.light { color: rgba(254, 252, 245, 0.75); }

/* ── Illustrated hero (mento.cc structure, Otomata tokens) ── */
.hero { position: relative; color: var(--color-bg); overflow: hidden; }
.hero-bg img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.hero-veil { position: absolute; inset: 0;
  background: linear-gradient(to right, rgba(44, 33, 18, 0.88), rgba(44, 33, 18, 0.62) 55%, rgba(44, 33, 18, 0.30)); }
.hero-top { position: relative; display: flex; align-items: center; gap: 22px;
  max-width: 1080px; margin: 0 auto; padding: 18px 24px; }
.hbrand { font-family: var(--font-display); font-weight: 700; font-size: 18px; letter-spacing: -0.02em; }
.hbrand small { font-family: var(--font-sans); font-weight: 500; font-size: 12px; margin-left: 8px; opacity: 0.7; }
.hnav { margin-left: auto; display: flex; align-items: center; gap: 18px; }
.hnav a { font-size: 13.5px; font-weight: 600; color: rgba(254, 252, 245, 0.9); }
.hnav a:hover { color: #fff; text-decoration: none; }
.hnav a.cta { border: 1px solid rgba(254, 252, 245, 0.7); padding: 6px 14px; }
.hnav a.cta:hover { background: var(--color-bg); color: var(--color-ink); }
.hero-body { position: relative; max-width: 1080px; margin: 0 auto; padding: 84px 24px 96px; }
.hero h1 { font-family: var(--font-display); font-weight: 650; margin: 14px 0 20px;
  font-size: clamp(44px, 7.5vw, 76px); line-height: 0.97; letter-spacing: -0.025em; }
.hero .lede { max-width: 540px; font-size: 17px; line-height: 1.6; color: rgba(254, 252, 245, 0.88); margin: 0 0 30px; }
.hero .lede b { color: #fff; }

.actions { display: flex; gap: 14px; flex-wrap: wrap; align-items: center; }
.btn-solar { background: var(--color-primary); color: var(--color-primary-ink); padding: 11px 22px; font-weight: 700; font-size: 14.5px; }
.btn-solar:hover { background: var(--color-bg); color: var(--color-ink); text-decoration: none; }
.btn-ghost { font-weight: 600; font-size: 14.5px; color: inherit; border-bottom: 2px solid var(--color-primary); padding-bottom: 2px; }
.btn-ghost:hover { text-decoration: none; color: var(--color-primary); }

/* ── Illustrated features ── */
.feats { padding: 52px 0 12px; }
.fgrid { margin-top: 22px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 28px; }
.feat .fimg { border: 1px solid var(--color-hair); aspect-ratio: 16/10; overflow: hidden; }
.feat .fimg img { width: 100%; height: 100%; object-fit: cover; display: block; }
.feat h2 { font-family: var(--font-display); font-size: 18px; font-weight: 650; letter-spacing: -0.01em; margin: 14px 0 7px; }
.feat p { margin: 0; font-size: 13.5px; line-height: 1.6; color: var(--color-ink-soft); }

/* ── Six ideas (compact) ── */
.ideas { border-top: 1px solid var(--color-hair); margin-top: 44px; padding: 40px 0 8px; }
.igrid { margin-top: 22px; display: grid; grid-template-columns: 1fr 1fr; gap: 18px 36px; }
.idea { display: flex; gap: 14px; align-items: baseline; }
.idea .num { font-family: var(--font-mono); font-size: 11px; color: var(--color-primary-ink); background: var(--color-primary-soft); padding: 2px 7px; flex: none; }
.idea h3 { font-family: var(--font-display); font-size: 15.5px; font-weight: 650; margin: 0 0 3px; }
.idea p { margin: 0; font-size: 13px; line-height: 1.55; color: var(--color-ink-soft); }

/* ── Numbered steps ── */
.steps { border-top: 1px solid var(--color-hair); margin-top: 44px; padding: 40px 0 56px; }
.sgrid { margin-top: 22px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 1px; background: var(--color-hair); border: 1px solid var(--color-hair); }
.step { background: var(--color-surface); padding: 20px 18px 24px; }
.step .snum { font-family: var(--font-display); font-size: 34px; font-weight: 650; color: var(--color-primary); line-height: 1; }
.step h3 { font-family: var(--font-display); font-size: 16px; font-weight: 650; margin: 10px 0 6px; }
.step p { margin: 0; font-size: 13px; line-height: 1.6; color: var(--color-ink-soft); }

/* ── Illustrated final CTA ── */
.final { position: relative; color: var(--color-bg); overflow: hidden; }
.final-bg img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.final-veil { position: absolute; inset: 0; background: rgba(44, 33, 18, 0.72); }
.final-body { position: relative; max-width: 1080px; margin: 0 auto; padding: 64px 24px; }
.final h2 { font-family: var(--font-display); font-size: clamp(24px, 3.5vw, 34px); font-weight: 650; letter-spacing: -0.015em; margin: 0 0 22px; max-width: 560px; }

.foot { border-top: 1px solid var(--color-hair); padding: 18px 24px; display: flex; align-items: baseline; gap: 14px; max-width: 1080px; margin: 0 auto; width: 100%; }
.brand-foot { font-family: var(--font-display); font-weight: 700; font-size: 15px; }
.foot .muted { font-size: 12.5px; }

@media (max-width: 860px) {
  .fgrid { grid-template-columns: 1fr; }
  .igrid { grid-template-columns: 1fr; }
  .sgrid { grid-template-columns: 1fr 1fr; }
  .hero-body { padding: 56px 24px 64px; }
}
@media (max-width: 520px) {
  .sgrid { grid-template-columns: 1fr; }
}
</style>
