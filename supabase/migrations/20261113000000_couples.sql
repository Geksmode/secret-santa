-- Couples : on n'offre jamais à son conjoint, même quand le tirage doit garder des cadeaux
-- dans une même famille. Le lien est symétrique : A conjoint de B ⇔ B conjoint de A.

alter table public.participants
  add column conjoint_id uuid references public.participants(id) on delete set null,
  add constraint participants_conjoint_pas_soi check (conjoint_id is null or conjoint_id <> id);

-- Définit (ou retire, avec null) le conjoint de p_id, des deux côtés, en défaisant les anciens liens.
create function public.admin_participant_conjoint(p_mdp text, p_id uuid, p_conjoint_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public._exiger_admin(p_mdp);
  if p_conjoint_id = p_id then raise exception 'conjoint_soi'; end if;
  update public.participants set conjoint_id = null
    where conjoint_id in (p_id, p_conjoint_id) or id in (p_id, p_conjoint_id);
  if p_conjoint_id is not null then
    update public.participants set conjoint_id = p_conjoint_id where id = p_id;
    update public.participants set conjoint_id = p_id where id = p_conjoint_id;
  end if;
end $$;
revoke execute on function public.admin_participant_conjoint(text, uuid, uuid) from public;
grant execute on function public.admin_participant_conjoint(text, uuid, uuid) to anon, authenticated;

create or replace function public.admin_etat(p_mdp text) returns json
language plpgsql stable security definer set search_path = public as $$
declare e public.editions; a_refaire boolean := false;
begin
  perform public._exiger_admin(p_mdp);
  e := public._edition_courante();
  if e.tiree then
    -- actifs sans tirage, tirés mais inactifs, plus de cadeaux internes qu'au tirage, ou cadeau à son conjoint
    a_refaire :=
      exists (select 1 from public.participants p where p.actif
              and not exists (select 1 from public.tirages t where t.edition_id = e.id and t.donneur_id = p.id))
      or exists (select 1 from public.tirages t join public.participants p on p.id in (t.donneur_id, t.receveur_id)
                 where t.edition_id = e.id and not p.actif)
      or (select count(*) from public.tirages t
                 join public.participants d on d.id = t.donneur_id
                 join public.participants r on r.id = t.receveur_id
                 where t.edition_id = e.id and d.foyer_id is not null and d.foyer_id = r.foyer_id) > e.meme_famille
      or exists (select 1 from public.tirages t join public.participants d on d.id = t.donneur_id
                 where t.edition_id = e.id and d.conjoint_id = t.receveur_id);
  end if;
  return json_build_object(
    'foyers', coalesce((select json_agg(json_build_object('id', id, 'nom', nom) order by nom) from public.foyers), '[]'::json),
    'participants', coalesce((select json_agg(json_build_object('id', id, 'prenom', prenom, 'foyer_id', foyer_id,
                      'actif', actif, 'conjoint_id', conjoint_id) order by prenom) from public.participants), '[]'::json),
    'edition', case when e.id is null then null else json_build_object(
      'id', e.id, 'annee', e.annee, 'budget', e.budget, 'date_echange', e.date_echange, 'tiree', e.tiree, 'meme_famille', e.meme_famille) end,
    'tirage_a_refaire', a_refaire);
end $$;
