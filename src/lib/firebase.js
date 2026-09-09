// ============================================================
// firebase.js — Initialisation Firebase (client)
// Persistance HORS-LIGNE activée : si le Wi-Fi tombe, les badges
// sont mis en file dans la tablette (IndexedDB) et envoyés
// automatiquement au retour du réseau. Capacité : des milliers
// de badges, largement au-delà d'une coupure réelle.
// ============================================================
import { initializeApp, getApps } from "firebase/app";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  getFirestore,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

// initializeFirestore avec cache persistant : file d'attente hors-ligne native.
// try/catch : en SSR (build) window/IndexedDB n'existent pas -> fallback simple.
let _db;
try {
  _db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
} catch (e) {
  _db = getFirestore(app);
}
export const db = _db;
