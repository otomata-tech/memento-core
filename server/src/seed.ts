/**
 * Seed for workspace #1 `example-kb`: doctrine + 3 sections + 1 document with
 * typed blocks + 1 source. Used to test the read foundation end-to-end via the
 * stdio MCP. Idempotent: does nothing if the workspace already exists.
 *
 * Run: npm run seed
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import {
  db,
  client,
  workspaces,
  sections,
  documents,
  blocks,
  sources,
  blockSources,
  settings,
} from "./db.js";

const PREAMBLE = `# Doctrine — Demo KB

Demonstration knowledge base (creativity methods). Knowledge here is split into sourced **typed blocks**, not sprawling documents.

## When to use which block type
- **PRINCIPE**: a guiding, durable truth. **REGLE**: a norm to apply. **EXCEPTION**: a case where the rule does not hold.
- **DEFINITION**: a framed term. **PROCEDURE**: a sequence of steps. **EXEMPLE**: a concrete illustration.
- **MISE_EN_GARDE**: a known pitfall. **QUESTION**: an open, unresolved point.
- **PROMPT_PORTEUR** / **PROMPT_SYSTEME**: tool cards (prompt aimed at the owner / sub-agent guardrails).

## Protocol
Doctrine-first: start from this map, target 2-3 sections, drill via mem_section/mem_document. Never load everything. A block carries ONE sourceable claim; if it needs two, split it. Writing = propose-validate loop (upcoming).`;

async function main(): Promise<void> {
  const existing = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.slug, "example-kb"))
    .limit(1);
  if (existing.length > 0) {
    console.error("[seed] workspace 'example-kb' already exists — nothing to do.");
    await client.end();
    return;
  }

  const [ws] = await db
    .insert(workspaces)
    .values({
      slug: "example-kb",
      name: "Demo KB",
      summary: "Demonstration base — creativity methods (typed, sourced blocks).",
    })
    .returning();

  await db.insert(settings).values({
    workspaceId: ws.id,
    key: "doctrine.preamble",
    value: PREAMBLE,
  });

  const sectionRows = await db
    .insert(sections)
    .values([
      {
        workspaceId: ws.id,
        title: "Creativity",
        slug: "creativite",
        summary: "Methods and tools to generate and sort ideas.",
        position: 0,
        depth: 0,
      },
      {
        workspaceId: ws.id,
        title: "Chinese strategy",
        slug: "strategie-chinoise",
        summary: "Think effectiveness through the potential of the situation (shi), not through the plan.",
        position: 1,
        depth: 0,
      },
      {
        workspaceId: ws.id,
        title: "Eco-design",
        slug: "eco-conception",
        summary: "Design while factoring in environmental impact across the whole life cycle.",
        position: 2,
        depth: 0,
      },
    ])
    .returning();

  const creativite = sectionRows.find((s) => s.slug === "creativite")!;

  const [doc] = await db
    .insert(documents)
    .values({
      sectionId: creativite.id,
      title: "Creativity toolbox",
      slug: "boite-a-outils-creativite",
      summary: "Principles and methods to open then close the field of ideas.",
      kind: "outil",
      status: "ACTIVE",
    })
    .returning();

  const [src] = await db
    .insert(sources)
    .values({
      kind: "MANUAL",
      title: "Creativity toolbox",
      citation: "B. Groff, La Boîte à outils de la créativité, Dunod, 4th ed.",
    })
    .returning();

  const blockRows = await db
    .insert(blocks)
    .values([
      {
        documentId: doc.id,
        type: "PRINCIPE",
        content:
          "Creativity is not a reserved gift: it is a discipline that can be trained. It alternates between two distinct phases that must never be mixed: opening up (diverging) then sorting (converging).",
        position: 0,
      },
      {
        documentId: doc.id,
        type: "DEFINITION",
        content:
          "Divergence: produce as many ideas as possible without judgment. Convergence: select and structure according to explicit criteria. Judging during divergence kills the flow.",
        position: 1,
      },
      {
        documentId: doc.id,
        type: "PROCEDURE",
        content:
          "Brainwriting 6-3-5: 6 participants write 3 ideas in 5 minutes, then pass their sheet to their neighbor who builds on them. 6 rounds → 108 ideas in 30 minutes, with no one speaking.",
        position: 2,
      },
      {
        documentId: doc.id,
        type: "MISE_EN_GARDE",
        content:
          "The classic pitfall: chaining divergence techniques without ever converging. With no sorting criteria defined in advance, the workshop produces volume but no decision.",
        position: 3,
      },
      {
        documentId: doc.id,
        type: "PROMPT_PORTEUR",
        content:
          "\"List 20 uses of your product you have never thought of. No self-censoring allowed: write down even the absurd ideas, we will sort them later.\"",
        position: 4,
      },
    ])
    .returning();

  // Coarse initial sourcing: the parent source on the PRINCIPE block.
  const principe = blockRows.find((b) => b.type === "PRINCIPE")!;
  await db.insert(blockSources).values({
    blockId: principe.id,
    sourceId: src.id,
    locator: "ch. 1",
  });

  console.error(
    `[seed] OK — workspace ${ws.slug}, ${sectionRows.length} sections, 1 document, ${blockRows.length} blocks.`,
  );
  await client.end();
}

main().catch(async (err) => {
  console.error("[seed] fatal:", err);
  await client.end().catch(() => {});
  process.exit(1);
});
