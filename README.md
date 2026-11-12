# Secret Santa

Outil de Secret Santa familial : liens personnels, exclusions par foyer et par rapport à l'an dernier, listes d'envies, FR/EN.

- Spec : `docs/superpowers/specs/2026-11-12-secret-santa-design.md`
- Plan : `docs/superpowers/plans/2026-11-12-secret-santa.md`

## Utilisation

- Page admin : `admin.html` (mot de passe admin).
- Chaque participant reçoit un lien `…/?t=<jeton>`, le même chaque année.

## Tests

```bash
npm test
```

```bash
node --env-file=.env tests/securite.mjs
```

`tests/scenario.mjs` crée puis efface des données fictives ; il refuse de tourner si des participants existent déjà.

`.env` (non versionné, modèle : `.env.example`) contient l'URL, les clés `anon` et `service_role`, et le mot de passe admin de test.

## Déploiement de la base

- Schéma : coller `supabase/migrations/20261112000000_schema.sql` dans le SQL Editor de Supabase et l'exécuter (projet neuf uniquement).
- Fonction de tirage :

```bash
npx supabase functions deploy lancer_tirage --remote=fkfnrbgxrulfqeypudwb --no-verify-jwt --use-api
```

- Changer le mot de passe admin (SQL Editor) :

```sql
insert into public.config (id, admin_hash)
values (1, extensions.crypt('MOT_DE_PASSE', extensions.gen_salt('bf')))
on conflict (id) do update set admin_hash = excluded.admin_hash;
```

## Secret du tirage

Aucun écran ni aucune fonction ne renvoie le tirage complet. Le propriétaire du projet Supabase peut techniquement lire la table `tirages` dans la console : ne pas l'ouvrir.
