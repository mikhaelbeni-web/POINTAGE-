-- ============================================================
-- schema.sql — Base Supabase (Postgres) de la pointeuse.
-- À exécuter UNE fois dans Supabase : SQL Editor > New query > coller > Run.
-- Ré-exécutable sans danger (create if not exists / create or replace).
--
-- Principe : chaque « collection » de l'ancienne base Firestore devient une table
--   id   text  (même identifiant qu'avant, ex. {magasin}_{salarié}_{date})
--   data jsonb (le document, champ pour champ, heures en millisecondes)
--   rev  bigint (version, +1 à chaque écriture : sert aux recalculs sûrs)
-- + des colonnes calculées et indexées (salarié, date, magasin) pour les recherches.
-- Les règles de calcul (pauses, journée coupée, présence) ne sont PAS en SQL :
-- elles restent dans l'application, inchangées.
--
-- Sécurité (RLS) : lecture autorisée à l'application, AUCUNE écriture directe.
-- Toute écriture passe par la fonction batch_write (tables autorisées seulement,
-- journal des badges et historiques jamais supprimables).
-- ============================================================

-- ---------- Fusion profonde (équivalent du « merge » Firestore) ----------
create or replace function public.jsonb_deep_merge(a jsonb, b jsonb)
returns jsonb language sql immutable as $$
  select case
    when jsonb_typeof(a) = 'object' and jsonb_typeof(b) = 'object' then (
      select coalesce(jsonb_object_agg(k,
        case when a ? k and b ? k then public.jsonb_deep_merge(a -> k, b -> k)
             when b ? k then b -> k else a -> k end), '{}'::jsonb)
      from (select jsonb_object_keys(a) as k union select jsonb_object_keys(b)) keys)
    else b end
$$;

-- Remplace le marqueur {"$st":1} (heure serveur) par l'heure du serveur en millisecondes.
create or replace function public.resolve_server_time(v jsonb, now_ms bigint)
returns jsonb language sql immutable as $$
  select case
    when v = '{"$st": 1}'::jsonb then to_jsonb(now_ms)
    when jsonb_typeof(v) = 'object' then (
      select coalesce(jsonb_object_agg(key, public.resolve_server_time(value, now_ms)), '{}'::jsonb) from jsonb_each(v))
    when jsonb_typeof(v) = 'array' then (
      select coalesce(jsonb_agg(public.resolve_server_time(value, now_ms)), '[]'::jsonb) from jsonb_array_elements(v))
    else v end
$$;

-- ---------- Tables ----------
-- Réglages, magasins, managers, tablettes
create table if not exists public.settings (id text primary key, data jsonb not null default '{}', rev bigint not null default 1, updated_at timestamptz not null default now());
create table if not exists public.sites    (id text primary key, data jsonb not null default '{}', rev bigint not null default 1, updated_at timestamptz not null default now());
create table if not exists public.managers (id text primary key, data jsonb not null default '{}', rev bigint not null default 1, updated_at timestamptz not null default now());
create table if not exists public.tablets  (id text primary key, data jsonb not null default '{}', rev bigint not null default 1, updated_at timestamptz not null default now());

-- Salariés : le matricule est unique (remplace l'ancienne collection « matricules »).
create table if not exists public.employees (
  id text primary key, data jsonb not null default '{}', rev bigint not null default 1, updated_at timestamptz not null default now(),
  matricule text generated always as (nullif(btrim(data->>'matricule'), '')) stored
);
create unique index if not exists employees_matricule_uniq on public.employees (matricule) where matricule is not null;

-- Tables rattachées à un salarié et une date.
do $$
declare t text;
begin
  foreach t in array array['punches','days','plannings','break_declarations','pause_ledger','planning_history','ledger_history','leaves'] loop
    execute format($f$
      create table if not exists public.%I (
        id text primary key, data jsonb not null default '{}', rev bigint not null default 1, updated_at timestamptz not null default now(),
        employee_id text generated always as (data->>'employeeId') stored,
        date        text generated always as (data->>'date') stored,
        site_id     text generated always as (data->>'siteId') stored
      )$f$, t);
    execute format('create index if not exists %I on public.%I (employee_id, date)', t || '_emp_date', t);
    execute format('create index if not exists %I on public.%I (date, site_id)', t || '_date_site', t);
  end loop;
end $$;
alter table public.ledger_history add column if not exists ledger_id text generated always as (data->>'ledgerId') stored;
create index if not exists ledger_history_ledger on public.ledger_history (ledger_id);

-- ---------- Sécurité : lecture seule pour l'application ----------
do $$
declare t text;
begin
  foreach t in array array['settings','sites','managers','tablets','employees','punches','days','plannings','break_declarations','pause_ledger','planning_history','ledger_history','leaves'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('drop policy if exists app_read on public.%I', t);
    execute format('create policy app_read on public.%I for select to anon, authenticated using (true)', t);
  end loop;
end $$;

-- ---------- Écriture groupée (équivalent writeBatch / transaction Firestore) ----------
-- p_ops      : [{ "t": table, "id": id, "op": "set"|"merge"|"update"|"delete", "data": {...} }]
-- p_preconds : [{ "t": table, "id": id, "rev": n }]  (rev 0 = le document ne doit pas exister)
-- Tout ou rien. Si une précondition ne tient plus (quelqu'un a écrit entre la lecture et
-- l'écriture), RIEN n'est écrit et la fonction renvoie {"ok": false} : l'application relit et recommence.
create or replace function public.batch_write(p_ops jsonb, p_preconds jsonb default '[]'::jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  allowed text[] := array['settings','sites','managers','tablets','employees','punches','days','plannings','break_declarations','pause_ledger','planning_history','ledger_history','leaves'];
  no_delete text[] := array['punches','planning_history','ledger_history'];
  now_ms bigint := (extract(epoch from clock_timestamp()) * 1000)::bigint;
  k record; o jsonb; p jsonb; cur bigint; d jsonb; n int;
begin
  if jsonb_typeof(p_ops) <> 'array' or jsonb_array_length(p_ops) > 500 then
    raise exception 'batch_write: 1 à 500 opérations';
  end if;
  -- Verrous dans un ordre fixe (pas d'interblocage) sur chaque document touché ou relu.
  for k in
    select distinct x->>'t' as t, x->>'id' as id
    from (select jsonb_array_elements(p_ops) x union all select jsonb_array_elements(coalesce(p_preconds, '[]'::jsonb))) s
    order by 1, 2
  loop
    if not (k.t = any(allowed)) then raise exception 'batch_write: table % interdite', k.t; end if;
    if k.id is null or k.id = '' then raise exception 'batch_write: id manquant'; end if;
    perform pg_advisory_xact_lock(hashtextextended(k.t || '/' || k.id, 0));
  end loop;
  -- Préconditions
  for p in select jsonb_array_elements(coalesce(p_preconds, '[]'::jsonb)) loop
    execute format('select rev from public.%I where id = $1', p->>'t') into cur using p->>'id';
    if coalesce(cur, 0) <> (p->>'rev')::bigint then
      return jsonb_build_object('ok', false, 'conflict', p);
    end if;
  end loop;
  -- Écritures, dans l'ordre
  for o in select jsonb_array_elements(p_ops) loop
    d := public.resolve_server_time(coalesce(o->'data', '{}'::jsonb), now_ms);
    if o->>'op' = 'set' then
      execute format('insert into public.%I as t (id, data) values ($1, $2)
        on conflict (id) do update set data = excluded.data, rev = t.rev + 1, updated_at = now()', o->>'t')
        using o->>'id', d;
    elsif o->>'op' = 'merge' then
      execute format('insert into public.%I as t (id, data) values ($1, $2)
        on conflict (id) do update set data = public.jsonb_deep_merge(t.data, excluded.data), rev = t.rev + 1, updated_at = now()', o->>'t')
        using o->>'id', d;
    elsif o->>'op' = 'update' then
      execute format('update public.%I set data = public.jsonb_deep_merge(data, $2), rev = rev + 1, updated_at = now() where id = $1', o->>'t')
        using o->>'id', d;
      get diagnostics n = row_count;
      if n = 0 then raise exception 'batch_write: document absent (%/%)', o->>'t', o->>'id'; end if;
    elsif o->>'op' = 'delete' then
      if (o->>'t') = any(no_delete) then raise exception 'batch_write: suppression interdite dans %', o->>'t'; end if;
      execute format('delete from public.%I where id = $1', o->>'t') using o->>'id';
    else
      raise exception 'batch_write: opération inconnue %', o->>'op';
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'serverMs', now_ms);
end $$;

revoke all on function public.batch_write(jsonb, jsonb) from public;
grant execute on function public.batch_write(jsonb, jsonb) to anon, authenticated;

-- ---------- Temps réel (tablettes et tableaux de bord mis à jour en direct) ----------
do $$
declare t text;
begin
  foreach t in array array['days','plannings','employees','sites','managers','tablets','settings'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
