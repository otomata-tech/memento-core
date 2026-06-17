-- Même filet que la 0005 : RLS deny-all (aucune policy) sur la nouvelle table
-- mem_usage_logs — la Data API est coupée, mais l'advisor Supabase et la
-- défense en profondeur valent pour toute table mem_*. Le rôle propriétaire
-- (Edge Functions via DATABASE_URL) bypasse, runtime inchangé.
ALTER TABLE "mem_usage_logs" ENABLE ROW LEVEL SECURITY;
