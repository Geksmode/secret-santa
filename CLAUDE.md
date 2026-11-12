# Secret Santa — consignes pour Claude

Outil de Secret Santa familial : site statique (GitHub Pages) + Supabase. Détails : `README.md`,
spec et plan dans `docs/superpowers/`.

## Règles métier (validées par Thanh Huy)
- Seule exclusion du tirage : soi-même et **sa propre famille**. Pas de règle « an dernier » (retirée le 2026-11-12).
- Si une famille dépasse la moitié des participants : tirage quand même, avec le **minimum** de cadeaux internes
  (`editions.meme_famille`), tiré au hasard parmi les tirages minimaux. Jamais soi-même.
- La base contient la vraie famille (LE 6, NGUYEN 4) : ne lancer aucun test qui écrit (`scenario.mjs` refuse de lui-même).
- Vocabulaire affiché : « Famille » (la table SQL s'appelle encore `foyers`).
- Personne ne doit voir le tirage complet : aucune fonction ni écran ne renvoie les paires ; les scripts de test
  n'impriment jamais de paire.

## Leçons du retex 2026-11-12
- **Secrets** : clé `service_role` et mot de passe admin uniquement dans `.env` (exclu de Git) et le SQL Editor ;
  demander à Thanh Huy de ne jamais les coller dans la conversation.
- **Base** : le schéma s'applique par le SQL Editor (pas de `supabase db push`, la CLI n'est pas liée).
  La fonction de tirage se déploie avec `--no-verify-jwt`, sinon elle refuse les appels du site.
- **Tests contre la vraie base** : `tests/scenario.mjs` crée puis efface des données fictives et refuse de
  tourner si des participants existent. Avant la vraie édition, effacer toute donnée de test.
- **Animations** : le PC de Thanh Huy a « réduire les animations » activé ; tester le mode animé en simulant
  le réglage (`window.matchMedia` surchargé + import du module avec `?anime=`), et le mode sobre tel quel.
- **Aperçu local** : `.claude/serve.cjs` (en `.cjs` car `package.json` est en `type: module`), il lit `PORT`.
- **Après publication** : GitHub Pages met les fichiers en cache 10 min ; prévenir (Ctrl+F5).
- **Écrire un test avant de corriger** : chaque correctif de la relecture a eu son test rouge puis vert
  (`tests/liens.test.js`, `tests/ressort.test.js`).
