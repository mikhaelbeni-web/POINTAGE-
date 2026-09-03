// ============================================================
// firebase.js — Initialisation Firebase (client)
// Remplace firebaseConfig par la config de TON projet
// (Firebase console > Paramètres du projet > tes applications).
// ============================================================
import { initializeApp, getApps } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
export const db = getFirestore(app);

// Site courant. Mono-site aujourd'hui ; passe cette valeur en dynamique
// (sélecteur de site) le jour où tu ajoutes des établissements.
export const SITE_ID = "main";
