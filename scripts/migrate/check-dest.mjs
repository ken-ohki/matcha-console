#!/usr/bin/env node
// Verify the destination project's Firestore + Storage + Auth are reachable.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { getAuth } from 'firebase-admin/auth'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__dirname, '..', '..')

const DEST_KEY_PATH = resolve(PROJECT_ROOT, '.dest-sa-key.json')
const DEST_DB_ID = 'matcha-console'
const DEST_BUCKET = 'sabo-matcha-1767687963419.firebasestorage.app'

const sa = JSON.parse(readFileSync(DEST_KEY_PATH, 'utf-8'))
if (getApps().length === 0) {
  initializeApp({ credential: cert(sa), projectId: sa.project_id, storageBucket: DEST_BUCKET })
}

console.log(`Destination project: ${sa.project_id}`)
console.log('---')

// Firestore
try {
  const db = getFirestore(DEST_DB_ID)
  const snap = await db.collection('_migration_check').limit(1).get()
  console.log(`✓ Firestore (db=${DEST_DB_ID}) reachable. docs: ${snap.size}`)
} catch (err) {
  console.log(`✗ Firestore (db=${DEST_DB_ID}) error:`, err.message)
}

// Storage
try {
  const bucket = getStorage().bucket()
  const [exists] = await bucket.exists()
  console.log(`✓ Storage bucket ${DEST_BUCKET}: ${exists ? 'exists' : 'NOT FOUND'}`)
} catch (err) {
  console.log(`✗ Storage error:`, err.message)
}

// Auth
try {
  const result = await getAuth().listUsers(1)
  console.log(`✓ Auth reachable. existing users: ${result.users.length}`)
} catch (err) {
  console.log(`✗ Auth error:`, err.message)
}
