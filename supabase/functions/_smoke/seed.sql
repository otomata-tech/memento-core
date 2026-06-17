-- Seed minimal pour le smoke test #42/#43 (conteneur jetable)
insert into mem_orgs (id, slug, name) values ('00000000-0000-0000-0000-00000000000a', 'test-org', 'Test Org');
insert into mem_workspaces (id, slug, name, org_id)
values ('00000000-0000-0000-0000-0000000000aa', 'smoke', 'Smoke KB', '00000000-0000-0000-0000-00000000000a');

insert into mem_sections (id, workspace_id, title, slug, depth) values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000aa', 'Stratégie', 'strategie', 1),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000aa', 'Archives', 'archives', 1);

insert into mem_documents (id, section_id, title, slug, status, kind) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', 'Doc actif stratégie', 'doc-actif', 'ACTIVE', 'note'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000b2', 'Doc actif archives', 'doc-archives', 'ACTIVE', 'cr'),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000b2', 'Doc périmé', 'doc-perime', 'DEPRECATED', 'note');

-- Vecteur quasi-unitaire orienté par la 1re composante (ordre kNN contrôlé)
create or replace function tvec(x float) returns vector language sql as $$
  select ('[' || x::text || ',' || array_to_string(array(select '0.01' from generate_series(1,1535)), ',') || ']')::vector
$$;

insert into mem_blocks (id, document_id, type, content, position, embedding, embedding_model, verified_at) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000d1', 'REGLE',  'La veille réglementaire est obligatoire chaque trimestre.', 0, tvec(0.99), 'test', now()),
  ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000d1', 'PROSE',  'La veille concurrentielle couvre les marchés publics européens.', 1, tvec(0.95), 'test', null),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000d2', 'REGLE',  'Ancienne règle de veille des appels d''offres.', 0, tvec(0.90), 'test', null),
  ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000d3', 'PROSE',  'Contenu périmé sur la veille des marchés.', 0, tvec(0.93), 'test', null);

-- e3 supersedé par e1 ; e2 contredit par e3
insert into mem_links (from_block_id, to_block_id, relation) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e3', 'SUPERSEDES'),
  ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000e2', 'CONTRADICTS');

insert into mem_sources (id, kind, title, ref) values
  ('00000000-0000-0000-0000-0000000000f1', 'URL', 'Source test', 'https://example.com');
insert into mem_block_sources (block_id, source_id) values
  ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000f1');

-- Révisions : une vieille (J-2) + une récente, pour tester mem_revisions({since})
insert into mem_revisions (workspace_id, target_type, target_id, op, reason, actor, created_at) values
  ('00000000-0000-0000-0000-0000000000aa', 'block', '00000000-0000-0000-0000-0000000000e3', 'update_block', 'ancienne édition', 'smoke', now() - interval '2 days'),
  ('00000000-0000-0000-0000-0000000000aa', 'block', '00000000-0000-0000-0000-0000000000e1', 'verify_block', 'vérification récente', 'smoke', now() - interval '1 hour');
