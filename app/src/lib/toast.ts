// Toasts de feedback — store réactif minimal, rendu par Toaster.vue (monté dans App.vue).
import { reactive } from "vue";

export type ToastKind = "ok" | "err" | "info";
export interface Toast { id: number; kind: ToastKind; message: string }

export const toasts = reactive<Toast[]>([]);
let seq = 0;

export function toast(message: string, kind: ToastKind = "info", ms = 3200): void {
  const id = ++seq;
  toasts.push({ id, kind, message });
  setTimeout(() => dismiss(id), ms);
}
export function dismiss(id: number): void {
  const i = toasts.findIndex((t) => t.id === id);
  if (i !== -1) toasts.splice(i, 1);
}
