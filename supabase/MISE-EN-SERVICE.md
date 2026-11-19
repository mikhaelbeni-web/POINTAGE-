# Passage de Firebase à Supabase : mode d'emploi

L'ancienne base (Firebase) reste en service jusqu'à l'étape 6. Tant que la PR n'est pas fusionnée, rien ne change pour les magasins.

## 1. Créer la base (une fois)
1. Supabase > New project : nom `pointage-g20`, région **Paris (eu-west-3)**, case « Enable Data API » cochée.
2. SQL Editor > New query : coller tout le contenu de `supabase/schema.sql` > **Run**. Résultat attendu : « Success. No rows returned ».
3. Project Settings > API : noter la **Project URL** et la clé **anon / publishable** (publiques). Ne jamais diffuser la clé `service_role` ni le mot de passe de la base.

## 2. Configurer Vercel
Settings > Environment Variables, ajouter pour **Preview** d'abord (pas Production) :
- `NEXT_PUBLIC_SUPABASE_URL` = la Project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` = la clé anon

Puis relancer le déploiement de la PR (Deployments > … > Redeploy). Le lien « Preview » de la PR utilise alors Supabase, la production reste sur Firebase.

## 3. Copie d'essai des données
Sur ton PC, dans le dossier du projet, sur la branche de la PR :
```
git fetch origin
git checkout claude/project-thread-lembb0
npm install
```
Ajouter les deux variables Supabase dans `.env.local` (à côté des variables Firebase existantes), puis :
```
npm run migrate
```
Résultat attendu à la fin : **« Tout est identique. »** Le fichier `migration-totaux.csv` (s'ouvre dans Excel) montre, pour chaque salarié et chaque mois, la présence, le travaillé et l'écart de pauses **avant / après** : la colonne « identique » doit dire « oui » partout.

Lecture Firestore : chaque document est lu une fois. Sur le plan gratuit (50 000 lectures/jour), lancer le matin après 9 h ou passer en Blaze avant.

## 4. Essai sur une tablette
Ouvrir le lien Preview sur une tablette de test : badger arrivée, pause, retour, départ ; couper le Wi-Fi, badger, rallumer : le badge doit apparaître dans le Tableau de bord en moins d'une minute.

## 5. Avant la bascule
- Passer le projet Supabase en **Pro** (Organization > Billing).
- Choisir un moment **magasins fermés**, toutes les tablettes allumées et connectées (un badge resté en attente dans une tablette sous Firebase ne serait pas recopié).

## 6. Bascule (environ 15 minutes)
1. `npm run migrate` une dernière fois (recopie tout, y compris les badges du jour) : « Tout est identique. »
2. Vercel : ajouter les deux variables Supabase aussi pour **Production**.
3. Fusionner la PR : Vercel déploie la nouvelle version.
4. Recharger chaque tablette (le code de déverrouillage reste mémorisé). Faire un badge test.

## Retour arrière
Si un problème apparaît : Vercel > Deployments > déploiement précédent > « Promote to Production ». L'app revient sur Firebase (les badges faits entre-temps sur Supabase seraient à ressaisir).
