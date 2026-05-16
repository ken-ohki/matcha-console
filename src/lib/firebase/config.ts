import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app'
import { getAuth, type Auth } from 'firebase/auth'
import { getFirestore, type Firestore } from 'firebase/firestore'
import { getStorage, type FirebaseStorage } from 'firebase/storage'

const requiredEnvVars = {
  NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
} as const

let firebaseApp: FirebaseApp | null = null
let firestoreDb: Firestore | null = null
let firebaseAuth: Auth | null = null
let firebaseStorage: FirebaseStorage | null = null

function getMissingEnvVars(): string[] {
  return Object.entries(requiredEnvVars)
    .filter(([, value]) => !value)
    .map(([key]) => key)
}

export function getFirebaseApp(): FirebaseApp {
  if (firebaseApp) return firebaseApp

  const missing = getMissingEnvVars()
  if (missing.length > 0) {
    throw new Error(`Firebase configuration is incomplete. Missing: ${missing.join(', ')}`)
  }

  firebaseApp = getApps().length > 0
    ? getApp()
    : initializeApp({
        apiKey: requiredEnvVars.NEXT_PUBLIC_FIREBASE_API_KEY,
        authDomain: requiredEnvVars.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
        projectId: requiredEnvVars.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
        storageBucket: requiredEnvVars.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
        messagingSenderId: requiredEnvVars.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
        appId: requiredEnvVars.NEXT_PUBLIC_FIREBASE_APP_ID,
      })

  return firebaseApp
}

export function getFirebaseDb(): Firestore {
  if (firestoreDb) return firestoreDb
  const app = getFirebaseApp()
  const databaseId = process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID || 'chaflow'
  firestoreDb = getFirestore(app, databaseId)
  return firestoreDb
}

export function getFirebaseAuthInstance(): Auth {
  if (firebaseAuth) return firebaseAuth
  firebaseAuth = getAuth(getFirebaseApp())
  return firebaseAuth
}

export function getFirebaseStorageInstance(): FirebaseStorage {
  if (firebaseStorage) return firebaseStorage
  firebaseStorage = getStorage(getFirebaseApp())
  return firebaseStorage
}
