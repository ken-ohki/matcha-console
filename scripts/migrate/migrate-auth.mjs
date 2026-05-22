#!/usr/bin/env node
// Migrate Auth users from source to destination.
// Limitations:
//   - For email/password users, Firebase exports password hashes that ARE re-importable IF we use the
//     same hash algorithm. importUsers() supports this.
//   - Google sign-in users: providerData carries the federated identity, re-imported via importUsers.
//
// Usage:
//   node scripts/migrate/migrate-auth.mjs            (dry-run)
//   node scripts/migrate/migrate-auth.mjs --apply
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { initializeApp, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(__dirname, '..', '..')
const APPLY = process.argv.includes('--apply')

for (const file of ['.env.local', '.env']) {
  try {
    const text = readFileSync(resolve(PROJECT_ROOT, file), 'utf-8')
    for (const line of text.split('\n')) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
      if (!m) continue
      if (!(m[1] in process.env)) process.env[m[1]] = m[2]
    }
  } catch {}
}

const srcSa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY)
const destSa = JSON.parse(readFileSync(resolve(PROJECT_ROOT, '.dest-sa-key.json'), 'utf-8'))

const srcApp = initializeApp({ credential: cert(srcSa), projectId: srcSa.project_id }, 'src')
const destApp = initializeApp({ credential: cert(destSa), projectId: destSa.project_id }, 'dest')
const srcAuth = getAuth(srcApp)
const destAuth = getAuth(destApp)

console.log(`Source:      ${srcSa.project_id}`)
console.log(`Destination: ${destSa.project_id}`)
console.log(`Mode:        ${APPLY ? 'APPLY (writing)' : 'DRY-RUN (read only)'}`)
console.log('---')

// List all users
const allUsers = []
let nextPageToken
do {
  const result = await srcAuth.listUsers(1000, nextPageToken)
  allUsers.push(...result.users)
  nextPageToken = result.pageToken
} while (nextPageToken)

console.log(`Source users: ${allUsers.length}`)
for (const u of allUsers) {
  const providers = u.providerData.map(p => p.providerId).join(',') || 'password'
  console.log(`  - ${u.email ?? '(no email)'} (uid=${u.uid}) [${providers}]`)
}

if (!APPLY) {
  console.log('\nRe-run with --apply to import to destination.')
  process.exit(0)
}

// Build import payloads
const toImport = allUsers.map(u => {
  const record = {
    uid: u.uid,
    email: u.email,
    emailVerified: u.emailVerified,
    displayName: u.displayName,
    photoURL: u.photoURL,
    phoneNumber: u.phoneNumber,
    disabled: u.disabled,
    metadata: {
      creationTime: u.metadata.creationTime,
      lastSignInTime: u.metadata.lastSignInTime,
    },
    providerData: u.providerData.map(p => ({
      uid: p.uid,
      email: p.email,
      displayName: p.displayName,
      photoURL: p.photoURL,
      providerId: p.providerId,
    })),
  }
  if (u.passwordHash) record.passwordHash = Buffer.from(u.passwordHash, 'base64')
  if (u.passwordSalt) record.passwordSalt = Buffer.from(u.passwordSalt, 'base64')
  return record
})

const result = await destAuth.importUsers(toImport, {
  hash: { algorithm: 'SCRYPT', key: Buffer.from(''), saltSeparator: Buffer.from(''), rounds: 8, memoryCost: 14 },
})
console.log('\n---')
console.log(`Imported successfully: ${result.successCount}`)
console.log(`Failed: ${result.failureCount}`)
if (result.errors.length > 0) {
  for (const e of result.errors.slice(0, 10)) {
    console.log(`  index ${e.index}: ${e.error.message}`)
  }
}
