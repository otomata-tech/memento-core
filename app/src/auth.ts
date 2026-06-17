/**
 * Client Supabase pour le SPA Memento (page de consentement OAuth + login).
 * Env : VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (clé anon publique).
 */
import { createClient } from "@supabase/supabase-js";

/**
 * Type d'arrivée OTP (invite|magiclink|recovery…), capturé AVANT createClient :
 * detectSessionInUrl consomme puis efface le fragment d'URL — au montage du
 * /callback il a déjà disparu. Sert à proposer la création d'un mot de passe
 * aux invités (compte provisionné sans mot de passe).
 */
export const arrivedVia = new URLSearchParams(window.location.hash.slice(1)).get("type");

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  { auth: { detectSessionInUrl: true, persistSession: true, autoRefreshToken: true } },
);

/**
 * SSO Google (provider OAuth Supabase). `redirectTo` doit être dans l'allowlist Supabase.
 * `prompt: select_account` force l'écran de choix de compte Google : sans lui, le
 * navigateur réutilise le compte par défaut (piège mobile — on se connecte avec le
 * mauvais compte Google sans le voir, et on atterrit sur une base vide).
 */
export async function signInWithGoogle(redirectTo: string): Promise<string | null> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo, queryParams: { prompt: "select_account" } },
  });
  return error?.message ?? null;
}
