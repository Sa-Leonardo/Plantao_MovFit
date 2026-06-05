import { initializeApp, getApps, deleteApp } from 'firebase/app';
import {
  getAuth,
  createUserWithEmailAndPassword,
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const usingFirebase = import.meta.env.VITE_DATA_PROVIDER === 'firebase';
const missing = Object.entries(firebaseConfig)
  .filter(([key, value]) => key !== 'storageBucket' && !value)
  .map(([key]) => key);

if (usingFirebase && missing.length > 0) {
  throw new Error(`Configuracao Firebase incompleta: ${missing.join(', ')}`);
}

export const firebaseApp = usingFirebase
  ? (getApps().find(app => app.name === '[DEFAULT]') || initializeApp(firebaseConfig))
  : null;
export const auth = firebaseApp ? getAuth(firebaseApp) : null;
export const db = firebaseApp ? getFirestore(firebaseApp) : null;

export function usernameToEmail(username) {
  const clean = String(username || '').trim().toLowerCase();
  if (!clean) return '';
  return clean.includes('@') ? clean : `${clean}@movfit.local`;
}

export async function createAuthUserWithSecondaryApp(username, password) {
  if (!usingFirebase) throw new Error('Firebase nao esta ativo.');
  const appName = `secondary-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const secondary = initializeApp(firebaseConfig, appName);
  try {
    const secondaryAuth = getAuth(secondary);
    return await createUserWithEmailAndPassword(secondaryAuth, usernameToEmail(username), password);
  } finally {
    await deleteApp(secondary);
  }
}
