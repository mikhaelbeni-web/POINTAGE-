# Pointage RLB

Badgeuse tablette + suivi des heures, temps réel multi-appareils. Next.js (App Router) + Firestore + Vercel.

## Ce que fait l'app

- **Badgeuse** (écran par défaut) : le salarié touche son nom, tape son **PIN 4 chiffres**, puis Arrivée / Départ pause / Retour pause / Départ. L'action proposée s'adapte à l'état de la journée.
- **Mode Manager** (bouton en haut à droite, protégé par un PIN manager séparé) :
  - **Tableau de bord** : présences, absences, retards du jour + alertes repos < 11h et seuil heures supp.
  - **Récaps & impression** : récap mensuel par salarié, semaine par semaine, totaux, lignes de signature → bouton **Imprimer / PDF**.
  - **Salariés** : contrat (plein/partiel), heures/semaine, jours travaillés, horaires prévus, PIN, actif/inactif.
  - **Paramètres** : repos min (660 min = 11h), tolérance retard (5 min), seuil supp (240 min = 4h), base temps plein (2205 min = 36h75 convention = 36h45 réelles), PIN manager.
- **Correction manuelle** d'une journée + saisie de congés/absences depuis le tableau de bord (bouton « Corriger »).

Toutes les durées sont calculées et stockées en **minutes entières**. `36h75` de la convention = 36h + 0,75×60 = **36h45 réelles = 2205 min**.

## Déploiement

### 1. Firebase
1. Crée un projet sur https://console.firebase.google.com
2. Active **Firestore Database** (mode production).
3. Ajoute une **application Web**, copie la config.
4. Déploie les règles : contenu de `firestore.rules` (voir avertissement sécurité dedans).

### 2. Variables d'environnement
Copie `.env.local.example` en `.env.local`, remplis avec ta config Firebase.

### 3. Local
```bash
npm install
npm run dev      # http://localhost:3000
```
Au **premier lancement**, l'app demande de définir le PIN manager.

### 4. Vercel
```bash
# pousse le repo, importe-le dans Vercel, ajoute les 6 variables
# NEXT_PUBLIC_FIREBASE_* dans Settings > Environment Variables
```

## Sécurité — à lire

- Les PIN sont **hachés SHA-256 + sel** avant stockage (`src/lib/pin.js`). Un PIN 4 chiffres reste faible par nature : SHA ne ralentit pas la force brute. Acceptable pour badger ; pour durcir le PIN manager, remplacer `verifyManagerPin` par un appel Cloud Function bcrypt — le reste ne bouge pas.
- Change les sels (`SALT_EMPLOYEE`, `SALT_MANAGER`) à l'installation.
- Les règles Firestore sont **ouvertes** (pas de Firebase Auth). Active **App Check** ou passe à Firebase Auth avant toute exposition hors réseau interne.

## Structure

```
src/lib/timeLogic.js   Logique métier pure (calculs, comp/supp, alertes) — testable seule
src/lib/recap.js       Agrégation hebdo/mensuelle
src/lib/store.js       Accès Firestore + recalcul des jours
src/lib/pin.js         Hachage PIN
src/lib/firebase.js    Init Firebase (SITE_ID = "main")
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
