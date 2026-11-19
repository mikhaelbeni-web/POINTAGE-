# Pointage RLB

Badgeuse tablette + suivi des heures, temps réel multi-appareils. Next.js (App Router) + Supabase (Postgres) + Vercel.

## Ce que fait l'app

- **Badgeuse** (écran par défaut) : le salarié touche son nom, tape son **PIN 4 chiffres**, puis Arrivée / Départ pause / Retour pause / Départ. L'action proposée s'adapte à l'état de la journée.
- **Mode Manager** (bouton en haut à droite, protégé par un PIN manager séparé) :
  - **Tableau de bord** : présences, absences, retards du jour + alertes repos < 11h et seuil heures supp.
  - **Récaps & impression** : récap mensuel par salarié, semaine par semaine, totaux, lignes de signature → bouton **Imprimer / PDF**.
  - **Salariés** : contrat (plein/partiel), heures/semaine, jours travaillés, horaires prévus, PIN, actif/inactif.
  - **Paramètres** : repos min (660 min = 11h), tolérance retard (5 min), seuil supp (240 min = 4h), base temps plein (2205 min = 36h75 convention = 36h45 réelles), PIN manager.
- **Correction manuelle** d'une journée + saisie de congés/absences depuis le tableau de bord (bouton « Corriger »).

Toutes les durées sont calculées et stockées en **minutes entières**. `36h75` de la convention = 36h + 0,75×60 = **36h45 réelles = 2205 min**.

## Planning, pauses et compteurs (évolution)

Nouvel onglet **Planning** dans le mode Manager, et colonnes planning / pauses intégrées au **Tableau de bord** (accessibles à tous les rôles, dans leur périmètre de magasins). Mêmes filtres que « Récaps & impression » : magasins à cocher + salarié.

- **Planning** (présentation reprise du calendrier Le Belleville, dépôt `Planning-RLB`) : grille semaine, matin et soir **indépendants**, saisie groupée, duplication de semaine, compteur d'heures, horaires habituels du matin et du soir (présaisie, toujours modifiables), impression A4 paysage de la semaine (« Imprimer » ou « Télécharger en PDF » = *Enregistrer au format PDF* dans la fenêtre d'impression). Aucun envoi d'e-mail.
- Trois états distincts par période : **à planifier** (rien de saisi, jamais assimilé à un repos), **non travaillé**, **travaillé** (arrivée-départ).
- **Pointeuse** : le pointage n'est jamais bloqué par l'absence de planning. Au départ, *si* un planning existe, le salarié voit le temps de pause attendu et déclare : prises / partielle / non prise, avec case de confirmation. « À régulariser » enregistre quand même le départ.
- **Pause attendue** (Paramètres) : 5 % du temps prévu, avec le minimum légal de 20 min dès 6 h de travail (règle configurable : à valider avec votre convention collective).
- **Compteur** : somme des écarts journaliers (jamais incrémenté, donc recalculable sans double comptage). Manquantes et supplémentaires séparées par défaut (option « solde net » dans Paramètres).
- **Modification rétroactive** : historique avant/après avec conséquences, pointages réels intacts.

Données : `plannings`, `planningHistory`, `breakDeclarations`, `pauseLedger`, `ledgerHistory`. Les calculs (`pauseLedger`) sont faits **après** le pointage, en arrière-plan (3 en parallèle au plus), avec reprise automatique.

### Tester sans toucher aux vraies données
- Page de démonstration : `/demo` (données fictives en mémoire, aucune écriture).
- Tests de logique : `npm run test:logic`.
- Tests de charge (ancienne version Firebase, non portés) : voir `scripts/` (`compare-loadtest.sh`, `loadtest-integration.js`) et `scripts/results/`.

## Déploiement

Base : **Supabase** (Postgres, région Paris). Mode d'emploi complet (création de la base, variables Vercel, copie depuis l'ancienne base Firebase, bascule, retour arrière) : `supabase/MISE-EN-SERVICE.md`.

En résumé :
1. Exécuter `supabase/schema.sql` dans le SQL Editor de Supabase.
2. Variables (Vercel et `.env.local`) : `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
3. `npm install` puis `npm run dev` (http://localhost:3000).

Tests : `npm run test:logic` (règles de calcul) ; `TEST_PG_URL=postgres://…/pointage_test npm run test:db` (base complète sur un Postgres local : pointage, recalculs simultanés, hors-ligne, sécurité).

### Comment la base est utilisée
- Chaque ancienne collection Firestore est une table (`id`, `data` = le document, `rev` = version). Les heures sont stockées en millisecondes.
- Toutes les écritures passent par la fonction SQL `batch_write` (tout ou rien). L'application ne peut ni écrire directement dans les tables ni supprimer le journal des badges ou les historiques.
- Recalculs sûrs : on relit, on calcule, on écrit seulement si rien n'a changé entre-temps, sinon on recommence.
- Hors-ligne : chaque badge part d'abord dans une file sur la tablette (`src/lib/outbox.js`), envoyée dans l'ordre au retour du réseau, sans doublon possible.
- Temps réel : Supabase Realtime, avec copie locale (salariés, magasins, jours et plannings du jour) pour fonctionner sans réseau.

## Sécurité — à lire

- Les PIN sont **hachés SHA-256 + sel** avant stockage (`src/lib/pin.js`). Un PIN 4 chiffres reste faible par nature : SHA ne ralentit pas la force brute. Acceptable pour badger ; pour durcir le PIN manager, remplacer `verifyManagerPin` par un appel Cloud Function bcrypt — le reste ne bouge pas.
- Change les sels (`SALT_EMPLOYEE`, `SALT_MANAGER`) à l'installation.
- La base est **lisible** par quiconque possède l'adresse de l'app et sa clé publique (comme l'ancienne base Firebase, ouverte). Les écritures, elles, passent uniquement par `batch_write` (tables autorisées, journal des badges non supprimable). Étape suivante possible : enregistrement de chaque tablette (code magasin vérifié côté serveur) et lecture réservée aux tablettes enregistrées.

## Structure

```
src/lib/timeLogic.js   Logique métier pure (calculs, comp/supp, alertes) — testable seule
src/lib/recap.js       Agrégation hebdo/mensuelle
src/lib/store.js       Accès base + recalcul des jours
src/lib/db.js          Client Supabase : lectures, écritures groupées, transactions, temps réel
src/lib/outbox.js      File hors-ligne des badges
src/lib/pin.js         Hachage PIN
src/components/        Badgeuse, Dashboard, Employees, DayEditor, Settings, Recap, ui
src/app/page.js        Orchestration
```

## Multi-sites (plus tard, sans migration)

Tout porte déjà `siteId` (= `"main"`). Pour ajouter un établissement :
1. Créer un doc `sites/{nouvelId}`.
2. Rendre `SITE_ID` dynamique (sélecteur de site en haut du mode manager).
3. Assigner `siteId` aux salariés. Aucune restructuration des données existantes.

## Limites connues

- Décompte **brut** des heures comp/supp (nombre de minutes), pas les **majorations €** — le CDC ne demande que l'identification. Pour valoriser, ajoute les taux de ta convention dans `classifyWeek`.
- Postes de nuit gérés défensivement (si départ < arrivée, +24h) mais non testés en production sur des rotations complexes.
- Comp/supp calculées à la **semaine ISO** (lundi→dimanche), conformément au droit du travail.
