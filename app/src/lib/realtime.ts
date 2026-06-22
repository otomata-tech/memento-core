// Live "inbox changed" — Supabase Realtime **Broadcast** (pub/sub, no postgres_changes
// → no row content on the wire). The server pings `inbox-user-<sub>` for every user who
// can act on the changed KB; we subscribe to OUR OWN topic only (keyed by the auth UUID,
// not a guessable slug) and, on a ping, REFETCH via the authorized REST endpoints — the
// channel carries no data. One write target: the shared store, so every surface updates
// live without navigation.
import { watch } from "vue";
import { supabase } from "../auth";
import { shell, loadInbox, loadPending } from "../stores/shell";

let channel: ReturnType<typeof supabase.channel> | null = null;
let throttle: ReturnType<typeof setTimeout> | null = null;
let started = false;

function onPing() {
  // Coalesce bursts (an apply touches many rows → many pings): one refetch / ~400ms.
  if (throttle) return;
  throttle = setTimeout(() => { throttle = null; }, 400);
  loadInbox();
  loadPending(shell.pendingWs);
  shell.realtimeTick++; // lists (InboxView/LoopView) watch this to reload themselves
}

async function resubscribe() {
  if (channel) { await supabase.removeChannel(channel); channel = null; }
  if (!shell.sub) return;
  channel = supabase.channel(`inbox-user-${shell.sub}`).on("broadcast", { event: "changed" }, onPing).subscribe();
}

/** Mount once (App.vue). Re-subscribes when the signed-in user changes. */
export function startRealtime() {
  if (started) return;
  started = true;
  resubscribe();
  watch(() => shell.sub, resubscribe);
}
