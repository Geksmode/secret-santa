# Secret Santa familial — spec de conception

Date : 2026-11-12 — validé en conversation par Thanh Huy.

## 1. Besoin

Outil web pour organiser le Secret Santa de la famille, réutilisable chaque année.

| Exigence | Décision |
|---|---|
| Révélation | Chaque participant reçoit un **lien personnel** et ne voit que son propre tirage |
| Exclusions | Pas soi-même, pas un membre de sa **famille** (table `foyers`, affichée « Famille »). Règle « pas la même personne que l'an dernier » **retirée** le 2026-11-12 à la demande de Thanh Huy |
| Taille | 10 à 30 participants |
| Appareils | Téléphone, tablette, ordinateur |
| Extras | Listes d'envies, budget et date d'échange, historique multi-années |
| Langues | Français + anglais |
| Hébergement | GitHub Pages (site statique) + Supabase (données, fonctions) |
| Secret | L'organisateur participe : **personne ne voit le tirage complet** dans l'outil |

Hors périmètre : envoi automatique d'e-mails/SMS (les liens sont copiés et envoyés à la main), comptes utilisateurs, chiffrement des tirages.

## 2. Architecture

```
Navigateur (GitHub Pages, HTML/CSS/JS sans framework)
   │  supabase-js (clé anon publique)
   ▼
Supabase
   ├─ Tables (RLS activé, aucune policy de lecture pour anon)
   └─ Fonctions Postgres SECURITY DEFINER (seul point d'accès)
```

- La clé `anon` est publique : toute la sécurité repose sur le RLS (aucun accès direct aux tables) et sur les fonctions, qui vérifient un jeton.
- **Limite assumée** : le propriétaire du compte Supabase peut lire les tables dans la console. L'outil n'affiche jamais le tirage complet ; le secret repose sur le fait de ne pas aller regarder.

## 3. Données

| Table | Colonnes principales |
|---|---|
| `foyers` | `id`, `nom` |
| `participants` | `id`, `prenom`, `foyer_id` (nullable), `actif` (bool), `jeton` (texte aléatoire ≥ 128 bits, unique) |
| `editions` | `id`, `annee` (unique), `budget` (texte libre, ex. « 30 € »), `date_echange` (date), `tiree` (bool) |
| `tirages` | `edition_id`, `donneur_id`, `receveur_id` — unique (`edition_id`, `donneur_id`) et (`edition_id`, `receveur_id`) |
| `envies` | `id`, `participant_id`, `texte`, `lien` (nullable), `ordre`, `cree_le` |

- Le jeton d'un participant est stable d'une année à l'autre : un même lien sert chaque année.
- Les listes d'envies appartiennent au participant (pas à une édition) ; chacun les met à jour quand il veut.
- Admin : un mot de passe unique, stocké **haché** (bcrypt via `pgcrypto`) dans une table `config`, vérifié par chaque fonction admin.

## 4. Fonctions Supabase (API)

Participant (paramètre `jeton`) :
- `moi(jeton)` → prénom, édition en cours (année, budget, date). Édition en cours = celle dont l'année est la plus grande.
- `mon_tirage(jeton)` → prénom du receveur pour l'édition en cours + sa liste d'envies ; « pas encore tiré » sinon.
- `mes_envies(jeton)`, `ajouter_envie(jeton, texte, lien)`, `modifier_envie(...)`, `supprimer_envie(jeton, id)`.

Admin (paramètre `mot_de_passe`) :
- CRUD foyers et participants ; `liens()` → prénom + URL personnelle de chaque participant actif.
- `creer_edition(annee, budget, date)`.
- `lancer_tirage(edition_id)` (Edge Function, voir §5) → renvoie **seulement** succès / échec + message, jamais les paires.
- `annuler_tirage(edition_id)` → supprime les paires (si un participant s'ajoute ou se retire).

Aucune fonction ne renvoie la liste des paires.

## 5. Algorithme du tirage

Exécuté **côté serveur** : `lancer_tirage` est une **Edge Function Supabase** (TypeScript). L'algorithme est un module TS pur (`tirage.ts`, sans dépendance à Supabase), testé unitairement ; l'Edge Function vérifie le mot de passe admin, lit les données avec la clé `service_role` (jamais exposée au navigateur), appelle le module et écrit les paires.

1. Participants = actifs. Interdit(d, r) si `d = r`, même foyer non nul, ou `r` était le receveur de `d` à l'édition précédente (année la plus proche inférieure).
2. Recherche par **backtracking avec ordre aléatoire** : on attribue les donneurs un par un (les plus contraints d'abord), en mélangeant les receveurs candidats. Résultat : une permutation valide tirée au hasard, ou la preuve qu'il n'y en a pas.
3. Pas de solution → message clair (« aucun tirage possible avec ces règles : le foyer X est trop grand ») et aucune écriture.
4. Insertion des paires dans une transaction ; `editions.tiree = true`.

Note : le backtracking aléatoire ne garantit pas une distribution parfaitement uniforme ; c'est acceptable pour un usage familial.

## 6. Écrans

**Page admin** (`/admin.html`, mot de passe saisi et gardé en `sessionStorage`) :
- Foyers et participants : ajouter, renommer, rattacher à un foyer, désactiver.
- Édition de l'année : budget, date, bouton « Lancer le tirage », bouton « Annuler le tirage ».
- Liens : liste prénom + bouton « Copier le lien ».
- L'admin ne voit jamais les paires (y compris la sienne, qu'il consulte via son propre lien).

**Page personnelle** (`/?t=<jeton>`) :
- En-tête : « Tu offres un cadeau à **X** », budget, date.
- Liste d'envies de X (lecture seule, liens cliquables).
- « Ma liste d'envies » : ajouter / modifier / supprimer.
- Jeton invalide → message « Lien invalide, demande ton lien à l'organisateur ».

Commun : sélecteur FR / EN (langue du navigateur par défaut, choix mémorisé en `localStorage`), mise en page responsive, textes sobres.

## 7. Erreurs et cas limites

- Tirage impossible → message explicite, rien n'est écrit.
- Participant ajouté après le tirage → l'admin voit un avertissement et doit annuler puis relancer le tirage.
- Première édition (pas d'historique) → seule la règle « an dernier » est ignorée.
- Réseau / Supabase indisponible → message « réessaie plus tard », pas de page blanche.
- Textes d'envies affichés en texte brut (pas d'injection HTML) ; liens limités à `http(s)://`.

## 8. Tests

- **Algorithme** : tests automatiques — sur des milliers de tirages aléatoires, aucune règle violée ; cas impossibles détectés (foyer > moitié du groupe, contraintes « an dernier » bloquantes) ; cas de 2 et 3 participants.
- **Sécurité** : avec la clé anon, `select` direct sur chaque table renvoie vide / refus ; `mon_tirage` avec un jeton faux ne renvoie rien ; fonctions admin refusent un mauvais mot de passe.
- **Interface** : aperçu local, testé en 1280×800, 820×1180 et 375×667, en FR et EN.
- Mise en ligne (commit + push GitHub Pages) uniquement avec l'accord de Thanh Huy.

## 9. Étapes

1. Projet Supabase (créé par Thanh Huy) : schéma, RLS, fonctions.
2. Algorithme du tirage + tests.
3. Page admin.
4. Page personnelle + listes d'envies.
5. Traductions FR / EN.
6. Tests sur les 3 tailles d'écran, puis publication GitHub Pages.
