/**
 * Supabase client for the Memento SPA (OAuth consent page + login).
 * Env: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (public anon key).
 */
import { createClient } from "@supabase/supabase-js";

/**
 * OTP arrival type (invite|magiclink|recovery…), captured BEFORE createClient:
 * detectSessionInUrl consumes then clears the URL fragment — by the time
 * /callback mounts it has already disappeared. Used to offer password creation
 * to invitees (account provisioned without a password).
 */
export const arrivedVia = new URLSearchParams(window.location.hash.slice(1)).get("type");

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  { auth: { detectSessionInUrl: true, persistSession: true, autoRefreshToken: true } },
);

/**
 * Google SSO (Supabase OAuth provider). `redirectTo` must be in the Supabase allowlist.
 * `prompt: select_account` forces the Google account-picker screen: without it, the
 * browser reuses the default account (mobile pitfall — you sign in with the wrong
 * Google account without noticing, and land on an empty knowledge base).
 */
export async function signInWithGoogle(redirectTo: string): Promise<string | null> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo, queryParams: { prompt: "select_account" } },
  });
  return error?.message ?? null;
}
