create extension if not exists pgcrypto with schema extensions;

-- ---------- Tables ----------
create table public.foyers (
  id uuid primary key default gen_random_uuid(),
  nom text not null check (length(trim(nom)) between 1 and 80)
);

create table public.participants (
  id uuid primary key default gen_random_uuid(),
  prenom text not null check (length(trim(prenom)) between 1 and 80),
  foyer_id uuid references public.foyers(id) on delete set null,
  actif boolean not null default true,
  jeton text not null unique default encode(extensions.gen_random_bytes(18), 'hex')
);

create table public.editions (
  id uuid primary key default gen_random_uuid(),
  annee int not null unique check (annee between 2000 and 2100),
  budget text not null default '' check (length(budget) <= 40),
  date_echange date,
  tiree boolean not null default false
);

create table public.tirages (
  edition_id uuid not null references public.editions(id) on delete cascade,
  donneur_id uuid not null references public.participants(id) on delete cascade,
  receveur_id uuid not null references public.participants(id) on delete cascade,
  primary key (edition_id, donneur_id),
  unique (edition_id, receveur_id),
  check (donneur_id <> receveur_id)
);

create table public.envies (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  texte text not null check (length(trim(texte)) between 1 and 500),
  lien text check (lien is null or (lien ~* '^https?://' and length(lien) <= 1000)),
  cree_le timestamptz not null default now()
);

create table public.config (
  id int primary key default 1 check (id = 1),
  admin_hash text not null
);

-- ---------- Fermeture totale des tables ----------
alter table public.foyers enable row level security;
alter table public.participants enable row level security;
alter table public.editions enable row level security;
alter table public.tirages enable row level security;
alter table public.envies enable row level security;
alter table public.config enable row level security;
revoke all on all tables in schema public from anon, authenticated;

-- ---------- Outils internes ----------
create function public._participant(p_jeton text) returns public.participants
language sql stable security definer set search_path = public as $$
  select * from public.participants where jeton = p_jeton and actif limit 1;
$$;

create function public._edition_courante() returns public.editions
language sql stable security definer set search_path = public as $$
  select * from public.editions order by annee desc limit 1;
$$;

create function public._exiger_admin(p_mdp text) returns void
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if not exists (select 1 from public.config where admin_hash = extensions.crypt(p_mdp, admin_hash)) then
    raise exception 'non_autorise';
  end if;
end $$;

create function public._lien_valide(p_lien text) returns text
language sql immutable as $$
  select nullif(trim(p_lien), '');
$$;

revoke execute on function public._participant(text), public._edition_courante(),
  public._exiger_admin(text), public._lien_valide(text) from public, anon, authenticated;

-- ---------- Participant ----------
create function public.moi(p_jeton text) returns json
language plpgsql stable security definer set search_path = public as $$
declare p public.participants; e public.editions;
begin
  p := public._participant(p_jeton);
  if p.id is null then return null; end if;
  e := public._edition_courante();
  return json_build_object(
    'prenom', p.prenom,
    'edition', case when e.id is null then null else json_build_object(
      'id', e.id, 'annee', e.annee, 'budget', e.budget, 'date_echange', e.date_echange, 'tiree', e.tiree) end);
end $$;

create function public.mon_tirage(p_jeton text) returns json
language plpgsql stable security definer set search_path = public as $$
declare p public.participants; e public.editions; r public.participants;
begin
  p := public._participant(p_jeton);
  if p.id is null then return null; end if;
  e := public._edition_courante();
  select pr.* into r from public.tirages t join public.participants pr on pr.id = t.receveur_id
    where t.edition_id = e.id and t.donneur_id = p.id;
  if r.id is null then return json_build_object('statut', 'pas_tire'); end if;
  return json_build_object('statut', 'tire', 'receveur', r.prenom, 'envies',
    coalesce((select json_agg(json_build_object('texte', v.texte, 'lien', v.lien) order by v.cree_le)
              from public.envies v where v.participant_id = r.id), '[]'::json));
end $$;

create function public.mes_envies(p_jeton text) returns json
language plpgsql stable security definer set search_path = public as $$
declare p public.participants;
begin
  p := public._participant(p_jeton);
  if p.id is null then return null; end if;
  return coalesce((select json_agg(json_build_object('id', v.id, 'texte', v.texte, 'lien', v.lien) order by v.cree_le)
                   from public.envies v where v.participant_id = p.id), '[]'::json);
end $$;

create function public.ajouter_envie(p_jeton text, p_texte text, p_lien text) returns uuid
language plpgsql security definer set search_path = public as $$
declare p public.participants; nid uuid;
begin
  p := public._participant(p_jeton);
  if p.id is null then return null; end if;
  if (select count(*) from public.envies where participant_id = p.id) >= 30 then raise exception 'trop_d_envies'; end if;
  insert into public.envies (participant_id, texte, lien)
    values (p.id, trim(p_texte), public._lien_valide(p_lien)) returning id into nid;
  return nid;
end $$;

create function public.modifier_envie(p_jeton text, p_id uuid, p_texte text, p_lien text) returns void
language plpgsql security definer set search_path = public as $$
declare p public.participants;
begin
  p := public._participant(p_jeton);
  if p.id is null then return; end if;
  update public.envies set texte = trim(p_texte), lien = public._lien_valide(p_lien)
    where id = p_id and participant_id = p.id;
end $$;

create function public.supprimer_envie(p_jeton text, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare p public.participants;
begin
  p := public._participant(p_jeton);
  if p.id is null then return; end if;
  delete from public.envies where id = p_id and participant_id = p.id;
end $$;

-- ---------- Admin ----------
create function public.verifier_admin(p_mdp text) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from public.config where admin_hash = extensions.crypt(p_mdp, admin_hash));
$$;

create function public.admin_etat(p_mdp text) returns json
language plpgsql stable security definer set search_path = public as $$
declare e public.editions; a_refaire boolean := false;
begin
  perform public._exiger_admin(p_mdp);
  e := public._edition_courante();
  if e.tiree then
    -- actifs sans tirage, tirés mais inactifs, ou paire devenue interdite (même foyer)
    a_refaire :=
      exists (select 1 from public.participants p where p.actif
              and not exists (select 1 from public.tirages t where t.edition_id = e.id and t.donneur_id = p.id))
      or exists (select 1 from public.tirages t join public.participants p on p.id in (t.donneur_id, t.receveur_id)
                 where t.edition_id = e.id and not p.actif)
      or exists (select 1 from public.tirages t
                 join public.participants d on d.id = t.donneur_id
                 join public.participants r on r.id = t.receveur_id
                 where t.edition_id = e.id and d.foyer_id is not null and d.foyer_id = r.foyer_id);
  end if;
  return json_build_object(
    'foyers', coalesce((select json_agg(json_build_object('id', id, 'nom', nom) order by nom) from public.foyers), '[]'::json),
    'participants', coalesce((select json_agg(json_build_object('id', id, 'prenom', prenom, 'foyer_id', foyer_id, 'actif', actif) order by prenom) from public.participants), '[]'::json),
    'edition', case when e.id is null then null else json_build_object(
      'id', e.id, 'annee', e.annee, 'budget', e.budget, 'date_echange', e.date_echange, 'tiree', e.tiree) end,
    'tirage_a_refaire', a_refaire);
end $$;

create function public.admin_foyer_ajouter(p_mdp text, p_nom text) returns uuid
language plpgsql security definer set search_path = public as $$
declare nid uuid;
begin
  perform public._exiger_admin(p_mdp);
  insert into public.foyers (nom) values (trim(p_nom)) returning id into nid;
  return nid;
end $$;

create function public.admin_foyer_renommer(p_mdp text, p_id uuid, p_nom text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._exiger_admin(p_mdp);
  update public.foyers set nom = trim(p_nom) where id = p_id;
end $$;

create function public.admin_foyer_supprimer(p_mdp text, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._exiger_admin(p_mdp);
  delete from public.foyers where id = p_id;
end $$;

create function public.admin_participant_ajouter(p_mdp text, p_prenom text, p_foyer_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare nid uuid;
begin
  perform public._exiger_admin(p_mdp);
  insert into public.participants (prenom, foyer_id) values (trim(p_prenom), p_foyer_id) returning id into nid;
  return nid;
end $$;

create function public.admin_participant_modifier(p_mdp text, p_id uuid, p_prenom text, p_foyer_id uuid, p_actif boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._exiger_admin(p_mdp);
  update public.participants set prenom = trim(p_prenom), foyer_id = p_foyer_id, actif = p_actif where id = p_id;
end $$;

create function public.admin_liens(p_mdp text) returns json
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._exiger_admin(p_mdp);
  return coalesce((select json_agg(json_build_object('prenom', prenom, 'jeton', jeton) order by prenom)
                   from public.participants where actif), '[]'::json);
end $$;

create function public.admin_enregistrer_edition(p_mdp text, p_annee int, p_budget text, p_date date) returns uuid
language plpgsql security definer set search_path = public as $$
declare nid uuid;
begin
  perform public._exiger_admin(p_mdp);
  insert into public.editions (annee, budget, date_echange) values (p_annee, coalesce(trim(p_budget), ''), p_date)
    on conflict (annee) do update set budget = excluded.budget, date_echange = excluded.date_echange
    returning id into nid;
  return nid;
end $$;

create function public.admin_annuler_tirage(p_mdp text, p_edition_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._exiger_admin(p_mdp);
  delete from public.tirages where edition_id = p_edition_id;
  update public.editions set tiree = false where id = p_edition_id;
end $$;

-- ---------- Réservé à l'Edge Function (service_role) ----------
create function public.enregistrer_tirage(p_edition_id uuid, p_paires jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  -- verrou de ligne : deux appels simultanés sont sérialisés
  if (select tiree from public.editions where id = p_edition_id for update) then
    raise exception 'deja_tire';
  end if;
  insert into public.tirages (edition_id, donneur_id, receveur_id)
    select p_edition_id, (x->>'donneur')::uuid, (x->>'receveur')::uuid from jsonb_array_elements(p_paires) x;
  update public.editions set tiree = true where id = p_edition_id;
end $$;

-- ---------- Droits d'exécution ----------
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.moi(text), public.mon_tirage(text), public.mes_envies(text),
  public.ajouter_envie(text, text, text), public.modifier_envie(text, uuid, text, text), public.supprimer_envie(text, uuid),
  public.verifier_admin(text), public.admin_etat(text),
  public.admin_foyer_ajouter(text, text), public.admin_foyer_renommer(text, uuid, text), public.admin_foyer_supprimer(text, uuid),
  public.admin_participant_ajouter(text, text, uuid), public.admin_participant_modifier(text, uuid, text, uuid, boolean),
  public.admin_liens(text), public.admin_enregistrer_edition(text, int, text, date), public.admin_annuler_tirage(text, uuid)
  to anon;
grant execute on function public.enregistrer_tirage(uuid, jsonb), public.verifier_admin(text) to service_role;
