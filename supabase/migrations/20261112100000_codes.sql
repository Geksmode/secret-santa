-- Code personnel à 8 caractères pour retrouver son tirage depuis la page d'accueil.
-- Alphabet identique à js/code.js (31 caractères, sans 0 O 1 I L) : 31^8 ≈ 8,5·10^11 combinaisons.

create function public._code_aleatoire() returns text
language plpgsql volatile set search_path = public, extensions as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  octets bytea := extensions.gen_random_bytes(8);
  res text := '';
begin
  for i in 0..7 loop
    res := res || substr(alphabet, (get_byte(octets, i) % 31) + 1, 1);
  end loop;
  return res;
end $$;
revoke execute on function public._code_aleatoire() from public, anon, authenticated;

-- Remplit aussi les participants déjà existants (valeur par défaut évaluée ligne par ligne).
alter table public.participants
  add column code text not null unique default public._code_aleatoire();

-- Accueil : code → jeton (null si inconnu ou participant désactivé).
create function public.jeton_par_code(p_code text) returns text
language sql stable security definer set search_path = public as $$
  select jeton from public.participants
  where code = upper(regexp_replace(coalesce(p_code, ''), '[\s-]', '', 'g')) and actif
  limit 1;
$$;
revoke execute on function public.jeton_par_code(text) from public, authenticated;
grant execute on function public.jeton_par_code(text) to anon;

-- Admin : les liens renvoient aussi le code.
create or replace function public.admin_liens(p_mdp text) returns json
language plpgsql stable security definer set search_path = public as $$
begin
  perform public._exiger_admin(p_mdp);
  return coalesce((select json_agg(json_build_object('prenom', prenom, 'jeton', jeton, 'code', code) order by prenom)
                   from public.participants where actif), '[]'::json);
end $$;
