# Dev local memento.dev (honcho start). Stack Edge-native : functions Deno + viewer.
# DATABASE_URL / SUPABASE_AUTH_URL / MEMENTO_PUBLIC_URL injectés depuis .env (root).
# server/ = outillage Node uniquement (schéma canonique + migrations + admin), plus de runtime.
mcp: PORT=8093 /home/alexis/.deno/bin/deno run --no-lock --config supabase/functions/deno.json -A supabase/functions/mcp/index.ts
api: PORT=8094 /home/alexis/.deno/bin/deno run --no-lock --config supabase/functions/deno.json -A supabase/functions/api/index.ts
viewer: cd app && npx vite --host --port 5188
