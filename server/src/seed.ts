/**
 * Seed du workspace #1 `example-kb` : doctrine + 3 sections + 1 document avec
 * blocs typés + 1 source. Sert à tester le socle lecture de bout en bout via le
 * MCP stdio. Idempotent : ne fait rien si le workspace existe déjà.
 *
 * Lancer : npm run seed
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

Base de connaissance de démonstration (méthodes de créativité). Le savoir y est découpé en **blocs typés** sourcés, pas en documents-fleuves.

## Quand utiliser quel type de bloc
- **PRINCIPE** : une vérité directrice, durable. **REGLE** : une norme à appliquer. **EXCEPTION** : un cas où la règle ne tient pas.
- **DEFINITION** : un terme cadré. **PROCEDURE** : une suite d'étapes. **EXEMPLE** : une illustration concrète.
- **MISE_EN_GARDE** : un piège connu. **QUESTION** : un point ouvert non tranché.
- **PROMPT_PORTEUR** / **PROMPT_SYSTEME** : fiches outil (prompt destiné au porteur / garde-fous du sous-agent).

## Protocole
Doctrine-first : partir de cette carte, cibler 2-3 sections, drill via mem_section/mem_document. Ne jamais tout charger. Un bloc porte UNE affirmation sourçable ; s'il en faut deux, le scinder. Écriture = boucle propose-valide (à venir).`;

async function main(): Promise<void> {
  const existing = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.slug, "example-kb"))
    .limit(1);
  if (existing.length > 0) {
    console.error("[seed] workspace 'example-kb' existe déjà — rien à faire.");
    await client.end();
    return;
  }

  const [ws] = await db
    .insert(workspaces)
    .values({
      slug: "example-kb",
      name: "Demo KB",
      summary: "Base de démonstration — méthodes de créativité (blocs typés, sourcés).",
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
        title: "Créativité",
        slug: "creativite",
        summary: "Méthodes et outils pour générer et trier des idées.",
        position: 0,
        depth: 0,
      },
      {
        workspaceId: ws.id,
        title: "Stratégie chinoise",
        slug: "strategie-chinoise",
        summary: "Penser l'efficacité par le potentiel de situation (shi), non par le plan.",
        position: 1,
        depth: 0,
      },
      {
        workspaceId: ws.id,
        title: "Éco-conception",
        slug: "eco-conception",
        summary: "Concevoir en intégrant l'impact environnemental sur tout le cycle de vie.",
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
      title: "Boîte à outils de la créativité",
      slug: "boite-a-outils-creativite",
      summary: "Principes et procédés pour ouvrir puis refermer le champ des idées.",
      kind: "outil",
      status: "ACTIVE",
    })
    .returning();

  const [src] = await db
    .insert(sources)
    .values({
      kind: "MANUAL",
      title: "Boîte à outils de la créativité",
      citation: "B. Groff, La Boîte à outils de la créativité, Dunod, 4e éd.",
    })
    .returning();

  const blockRows = await db
    .insert(blocks)
    .values([
      {
        documentId: doc.id,
        type: "PRINCIPE",
        content:
          "La créativité n'est pas un don réservé : c'est une discipline qui s'entraîne. Elle alterne deux temps distincts qu'il ne faut jamais mélanger : ouvrir (diverger) puis trier (converger).",
        position: 0,
      },
      {
        documentId: doc.id,
        type: "DEFINITION",
        content:
          "Divergence : produire un maximum d'idées sans jugement. Convergence : sélectionner et structurer selon des critères explicites. Juger pendant la divergence tue le flux.",
        position: 1,
      },
      {
        documentId: doc.id,
        type: "PROCEDURE",
        content:
          "Brainwriting 6-3-5 : 6 participants écrivent 3 idées en 5 minutes, puis passent leur feuille au voisin qui rebondit. 6 tours → 108 idées en 30 minutes, sans prise de parole.",
        position: 2,
      },
      {
        documentId: doc.id,
        type: "MISE_EN_GARDE",
        content:
          "Le piège classique : enchaîner les techniques de divergence sans jamais converger. Sans critères de tri définis à l'avance, l'atelier produit du volume mais aucune décision.",
        position: 3,
      },
      {
        documentId: doc.id,
        type: "PROMPT_PORTEUR",
        content:
          "« Liste 20 usages de ton produit auxquels tu n'as jamais pensé. Interdiction de te censurer : note même les idées absurdes, on triera après. »",
        position: 4,
      },
    ])
    .returning();

  // Sourcing initial grossier : la source-mère sur le bloc PRINCIPE.
  const principe = blockRows.find((b) => b.type === "PRINCIPE")!;
  await db.insert(blockSources).values({
    blockId: principe.id,
    sourceId: src.id,
    locator: "chap. 1",
  });

  console.error(
    `[seed] OK — workspace ${ws.slug}, ${sectionRows.length} sections, 1 document, ${blockRows.length} blocs.`,
  );
  await client.end();
}

main().catch(async (err) => {
  console.error("[seed] fatal:", err);
  await client.end().catch(() => {});
  process.exit(1);
});
