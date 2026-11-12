-- Tirage assoupli : quand les familles ne peuvent pas toutes être séparées (ex. 6 et 4),
-- le tirage garde le minimum de cadeaux internes. On mémorise ce nombre pour l'afficher
-- et pour ne pas signaler à tort « tirage à refaire ».

alter table public.editions add column meme_famille int not null default 0;

drop function public.enregistrer_tirage(uuid, jsonb);
create function public.enregistrer_tirage(p_edition_id uuid, p_paires jsonb, p_meme_famille int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if (select tiree from public.editions where id = p_edition_id for update) then
    raise exception 'deja_tire';
  end if;
  insert into public.tirages (edition_id, donneur_id, receveur_id)
    select p_edition_id, (x->>'donneur')::uuid, (x->>'receveur')::uuid from jsonb_array_elements(p_paires) x;
  update public.editions set tiree = true, meme_famille = coalesce(p_meme_famille, 0) where id = p_edition_id;
end $$;
revoke execute on function public.enregistrer_tirage(uuid, jsonb, int) from public, anon, authenticated;
grant execute on function public.enregistrer_tirage(uuid, jsonb, int) to service_role;

create or replace function public.admin_annuler_tirage(p_mdp text, p_edition_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._exiger_admin(p_mdp);
  delete from public.tirages where edition_id = p_edition_id;
  update public.editions set tiree = false, meme_famille = 0 where id = p_edition_id;
end $$;

create or replace function public.admin_etat(p_mdp text) returns json
language plpgsql stable security definer set search_path = public as $$
declare e public.editions; a_refaire boolean := false;
begin
  perform public._exiger_admin(p_mdp);
  e := public._edition_courante();
  if e.tiree then
    -- actifs sans tirage, tirés mais inactifs, ou plus de cadeaux internes qu'au moment du tirage
    a_refaire :=
      exists (select 1 from public.participants p where p.actif
              and not exists (select 1 from public.tirages t where t.edition_id = e.id and t.donneur_id = p.id))
      or exists (select 1 from public.tirages t join public.participants p on p.id in (t.donneur_id, t.receveur_id)
                 where t.edition_id = e.id and not p.actif)
      or (select count(*) from public.tirages t
                 join public.participants d on d.id = t.donneur_id
                 join public.participants r on r.id = t.receveur_id
                 where t.edition_id = e.id and d.foyer_id is not null and d.foyer_id = r.foyer_id) > e.meme_famille;
  end if;
  return json_build_object(
    'foyers', coalesce((select json_agg(json_build_object('id', id, 'nom', nom) order by nom) from public.foyers), '[]'::json),
    'participants', coalesce((select json_agg(json_build_object('id', id, 'prenom', prenom, 'foyer_id', foyer_id, 'actif', actif) order by prenom) from public.participants), '[]'::json),
    'edition', case when e.id is null then null else json_build_object(
      'id', e.id, 'annee', e.annee, 'budget', e.budget, 'date_echange', e.date_echange, 'tiree', e.tiree, 'meme_famille', e.meme_famille) end,
    'tirage_a_refaire', a_refaire);
end $$;
