/**
 * Smoke test #41 (mem_list / mem_count / mem_revisions since) on the same
 * controlled dataset as search_42_43.ts — see the run instructions there.
 *   cd supabase/functions && DATABASE_URL=postgresql://postgres:test@localhost:5499/memento \
 *     deno run -A _smoke/list_41.ts
 */
import { listItems, countItems } from "../_shared/list.ts";
import { listRevisions } from "../_shared/revisions.ts";

const id = (s: string) => `00000000-0000-0000-0000-0000000000${s}`;
let failures = 0;
const check = (cond: boolean, msg: string) => {
  console.log(`${cond ? "✅" : "❌"} ${msg}`);
  if (!cond) failures++;
};

// ── mem_list blocks: exhaustive + filters ──
const all = await listItems({ workspace: "smoke" });
check(all.totalCount === 4 && all.items.length === 4 && !all.hasMore, `list blocks: 4/4, hasMore=false (got ${all.items.length}/${all.totalCount})`);
const row = all.items[0] as Record<string, unknown>;
check(["id", "type", "excerpt", "docPath", "docStatus", "verifiedAt", "updatedAt", "sourceCount", "superseded", "contradicted"].every((k) => k in row), "compact row: all judgment columns present");
check(typeof row.excerpt === "string" && (row.excerpt as string).length <= 101, `excerpt bounded ≤100c (got ${(row.excerpt as string).length})`);

const regles = await listItems({ workspace: "smoke", blockType: "REGLE" });
check(regles.totalCount === 2, `blockType=REGLE: 2 (got ${regles.totalCount})`);

const nonVerif = await listItems({ workspace: "smoke", verified: false });
check(nonVerif.totalCount === 3 && nonVerif.items.every((i) => (i as Record<string, unknown>).verifiedAt === null), `verified=false: 3 unverified (got ${nonVerif.totalCount})`);

const reglesNonVerif = await listItems({ workspace: "smoke", blockType: "REGLE", verified: false });
check(reglesNonVerif.totalCount === 1 && (reglesNonVerif.items[0] as Record<string, unknown>).id === id("e3"), `"unverified REGLE": only e3 (got ${reglesNonVerif.totalCount})`);

const sourced = await listItems({ workspace: "smoke", hasSource: true });
check(sourced.totalCount === 1 && (sourced.items[0] as Record<string, unknown>).id === id("e1"), `hasSource=true: only e1 (got ${sourced.totalCount})`);
const unsourced = await listItems({ workspace: "smoke", hasSource: false });
check(unsourced.totalCount === 3, `hasSource=false: 3 (got ${unsourced.totalCount})`);

const dep = await listItems({ workspace: "smoke", docStatus: "DEPRECATED" });
check(dep.totalCount === 1 && (dep.items[0] as Record<string, unknown>).id === id("e4"), `docStatus=DEPRECATED: only e4 (got ${dep.totalCount})`);

const strat = await listItems({ workspace: "smoke", sectionPath: "smoke/strategie" });
check(strat.totalCount === 2, `sectionPath strategie: 2 (got ${strat.totalCount})`);
const noSec = await listItems({ workspace: "smoke", sectionPath: "smoke/inexistante" });
check(noSec.totalCount === 0 && !noSec.hasMore, "nonexistent sectionPath: 0, no error");

const futureOnly = await listItems({ workspace: "smoke", updatedSince: "2099-01-01T00:00:00Z" });
check(futureOnly.totalCount === 0, "updatedSince future: 0");
const untilFuture = await listItems({ workspace: "smoke", updatedUntil: "2099-01-01T00:00:00Z" });
check(untilFuture.totalCount === 4, "updatedUntil future: 4");

// ── Keyset pagination: disjoint pages, complete union, stable totalCount ──
const p1 = await listItems({ workspace: "smoke", limit: 2 });
check(p1.items.length === 2 && p1.hasMore && p1.cursor !== null && p1.totalCount === 4, `page 1: 2 items, cursor, totalCount=4 (got ${p1.items.length}, hasMore=${p1.hasMore})`);
const p2 = await listItems({ workspace: "smoke", limit: 2, cursor: p1.cursor! });
check(p2.items.length === 2 && !p2.hasMore && p2.totalCount === 4, `page 2: 2 items, hasMore=false, stable totalCount (got ${p2.items.length}, ${p2.hasMore})`);
const ids = new Set([...p1.items, ...p2.items].map((i) => (i as Record<string, unknown>).id));
check(ids.size === 4, `disjoint pages, union = 4 blocks (got ${ids.size})`);
try {
  await listItems({ workspace: "smoke", cursor: "whatever" });
  check(false, "invalid cursor: should have thrown");
} catch (e) {
  check((e as Error).message.includes("cursor"), `invalid cursor → explicit error: "${(e as Error).message}"`);
}

// ── mem_list documents ──
const docs = await listItems({ workspace: "smoke", kind: "documents" });
check(docs.totalCount === 3, `list documents: 3 (got ${docs.totalCount})`);
const d1 = docs.items.find((i) => (i as Record<string, unknown>).id === id("d1")) as Record<string, unknown>;
check(d1?.blockCount === 2 && d1?.status === "ACTIVE", `d1: blockCount=2, status=ACTIVE (got ${d1?.blockCount}, ${d1?.status})`);
const crDocs = await listItems({ workspace: "smoke", kind: "documents", docKind: "cr" });
check(crDocs.totalCount === 1, `documents docKind=cr: 1 (got ${crDocs.totalCount})`);
try {
  await listItems({ workspace: "smoke", kind: "documents", blockType: "REGLE" });
  check(false, "blockType on documents: should have thrown");
} catch (e) {
  check(true, `non-applicable filter → explicit error: "${(e as Error).message}"`);
}

// ── mem_count ──
const total = await countItems({ workspace: "smoke" });
check(total.total === 4, `count blocks: 4 (got ${total.total})`);
const byType = await countItems({ workspace: "smoke", groupBy: "type" });
const typeMap = new Map(byType.groups!.map((g) => [g.key, g.count]));
check(typeMap.get("REGLE") === 2 && typeMap.get("PROSE") === 2, `groupBy type: REGLE=2, PROSE=2 (got ${JSON.stringify([...typeMap])})`);
const byStatus = await countItems({ workspace: "smoke", groupBy: "docStatus" });
const statusMap = new Map(byStatus.groups!.map((g) => [g.key, g.count]));
check(statusMap.get("ACTIVE") === 3 && statusMap.get("DEPRECATED") === 1, `groupBy docStatus: ACTIVE=3, DEPRECATED=1 (got ${JSON.stringify([...statusMap])})`);
const bySection = await countItems({ workspace: "smoke", groupBy: "section" });
const secMap = new Map(bySection.groups!.map((g) => [g.key, g.count]));
check(secMap.get("smoke/strategie") === 2 && secMap.get("smoke/archives") === 2, `groupBy section: slugified paths (got ${JSON.stringify([...secMap])})`);
const noSource = await countItems({ workspace: "smoke", hasSource: false });
check(noSource.total === 3, `"how many without a source": 3 (got ${noSource.total})`);
try {
  await countItems({ workspace: "smoke", kind: "documents", groupBy: "type" });
  check(false, "groupBy type on documents: should have thrown");
} catch (e) {
  check(true, `non-applicable groupBy → explicit error: "${(e as Error).message}"`);
}

// ── mem_revisions since ──
const allRevs = await listRevisions({ workspace: "smoke" });
check(allRevs.total === 2 && allRevs.hasMore === false, `revisions: total=2 (got ${allRevs.total})`);
const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
const recent = await listRevisions({ workspace: "smoke", since: dayAgo });
check(recent.total === 1 && recent.revisions[0].op === "verify_block", `since D-1: 1 recent revision (got ${recent.total})`);
try {
  await listRevisions({ workspace: "smoke", since: "not a date" });
  check(false, "invalid since: should have thrown");
} catch (e) {
  check(true, `invalid since → explicit error: "${(e as Error).message}"`);
}

console.log(failures ? `\n💥 ${failures} failure(s)` : "\n🎉 smoke test #41 PASS");
Deno.exit(failures ? 1 : 0);
