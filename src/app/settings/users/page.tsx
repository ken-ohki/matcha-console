'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AppLayout } from '@/components/layout/AppLayout'
import { useAuth } from '@/contexts/AuthContext'
import { getServices, type UserProfile } from '@/lib/services'
import { Plus, Save, Settings, ShieldCheck, Trash2, User2, X } from 'lucide-react'
import { getFirebaseAuthInstance } from '@/lib/firebase/config'

async function fetchIdToken(): Promise<string> {
  const auth = getFirebaseAuthInstance()
  const current = auth.currentUser
  if (!current) throw new Error('未ログイン')
  return current.getIdToken()
}

function CreateUserModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void
  onSubmit: (input: { email: string; password: string; role: 'admin' | 'viewer'; displayName?: string }) => Promise<void>
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [role, setRole] = useState<'admin' | 'viewer'>('viewer')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      await onSubmit({ email: email.trim(), password, role, displayName: displayName.trim() || undefined })
    } catch (err) {
      setError(err instanceof Error ? err.message : '作成に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div className="relative w-full max-w-md rounded-t-2xl bg-white p-6 shadow-2xl sm:rounded-2xl" onClick={e => e.stopPropagation()}>
        <button type="button" onClick={onClose} aria-label="閉じる" className="absolute right-3 top-3 rounded-full p-1.5 text-[#68756c] hover:bg-[#f4f2ea] hover:text-[#173c2a]">
          <X size={18} />
        </button>
        <h2 className="text-xl font-semibold text-[#173c2a]">ユーザーを追加</h2>
        <p className="mt-1 text-xs text-[#68756c]">メールアドレスと初期パスワードを指定して登録します。</p>

        {error && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
        )}

        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">メールアドレス</label>
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
              placeholder="name@example.com"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">表示名（任意）</label>
            <input
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">初期パスワード</label>
            <input
              type="text"
              required
              minLength={6}
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
              placeholder="6文字以上"
            />
            <p className="mt-1 text-[11px] text-[#68756c]">本人に共有してください。初回ログイン後に変更を推奨します。</p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">ロール</label>
            <select
              value={role}
              onChange={e => setRole(e.target.value as 'admin' | 'viewer')}
              className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
            >
              <option value="viewer">Viewer（閲覧のみ）</option>
              <option value="admin">Admin（全操作）</option>
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-[#174c33] px-4 py-2 text-sm font-medium text-white shadow transition hover:bg-[#205f43] disabled:opacity-60"
            >
              {saving ? '作成中…' : '作成'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function formatDate(date?: Date): string {
  if (!date) return '-'
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export default function SettingsUsersPage() {
  const [users, setUsers] = useState<UserProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [savingUid, setSavingUid] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)
  const [pendingRoles, setPendingRoles] = useState<Record<string, 'admin' | 'viewer'>>({})
  const [createOpen, setCreateOpen] = useState(false)
  const { user } = useAuth()

  const load = async () => {
    setLoading(true)
    const services = await getServices()
    const next = await services.auth.listUsers()
    setUsers(next)
    setPendingRoles({})
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  const isAdmin = user?.role === 'admin'

  const handleRoleSelect = (uid: string, role: 'admin' | 'viewer') => {
    setPendingRoles(prev => ({ ...prev, [uid]: role }))
  }

  const handleSave = async (target: UserProfile) => {
    const role = pendingRoles[target.uid]
    if (!role || role === target.role) return
    setSavingUid(target.uid)
    setFeedback(null)
    try {
      const services = await getServices()
      await services.auth.updateUserRole(target.uid, role)
      setFeedback({ tone: 'success', message: `${target.email} を ${role === 'admin' ? 'Admin' : 'Viewer'} に変更しました` })
      await load()
    } catch (err) {
      setFeedback({ tone: 'error', message: err instanceof Error ? err.message : '保存に失敗しました' })
    } finally {
      setSavingUid(null)
    }
  }

  const handleDelete = async (target: UserProfile) => {
    if (target.uid === user?.uid) {
      alert('自分自身は削除できません')
      return
    }
    if (!confirm(`${target.email} のユーザーを削除しますか？（ログイン認証ごと無効化されます）`)) return
    try {
      const token = await fetchIdToken()
      const res = await fetch(`/api/admin/users?uid=${encodeURIComponent(target.uid)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      setFeedback({ tone: 'success', message: `${target.email} を削除しました` })
      await load()
    } catch (err) {
      setFeedback({ tone: 'error', message: err instanceof Error ? err.message : '削除に失敗しました' })
    }
  }

  const handleCreate = async (input: { email: string; password: string; role: 'admin' | 'viewer'; displayName?: string }) => {
    const token = await fetchIdToken()
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(input),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      const errorMap: Record<string, string> = {
        invalid_email: 'メールアドレスが正しくありません',
        password_too_short: 'パスワードは 6 文字以上にしてください',
        email_already_exists: 'このメールアドレスは既に登録されています',
        not_admin: '管理者のみ操作できます',
      }
      throw new Error(errorMap[data.error] || data.error || `HTTP ${res.status}`)
    }
    setFeedback({ tone: 'success', message: `${input.email} を ${input.role} として作成しました` })
    setCreateOpen(false)
    await load()
  }

  if (!isAdmin) {
    return (
      <AppLayout>
        <div className="rounded-2xl border border-dashed border-[#d9d1be] bg-white p-10 text-center text-sm text-[#68756c]">
          このページは管理者のみアクセスできます。
        </div>
      </AppLayout>
    )
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-[#ece8ff] px-3 py-1 text-sm font-medium text-[#5e44a8]">
            <Settings size={15} />
            設定
          </div>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h1 className="mt-3 text-3xl font-bold text-[#173c2a]">ユーザー管理</h1>
              <p className="mt-2 text-sm text-[#68756c]">
                ユーザーを直接追加できます。または Google / メール+パスワードでログインすると自動的に Viewer として登録されます。
              </p>
            </div>
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="inline-flex items-center gap-2 self-start rounded-xl bg-[#174c33] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#123723]"
            >
              <Plus size={16} />
              ユーザーを追加
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 text-sm">
          <Link
            href="/settings/masters"
            className="rounded-full border border-[#d9d1be] bg-white px-3 py-1.5 text-[#173c2a] transition hover:bg-[#ece8db]"
          >
            マスター管理
          </Link>
          <Link
            href="/settings/users"
            className="rounded-full bg-[#174c33] px-3 py-1.5 text-white"
          >
            ユーザー管理
          </Link>
        </div>

        {feedback && (
          <div className={`rounded-xl border px-4 py-3 text-sm ${
            feedback.tone === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : 'border-red-200 bg-red-50 text-red-700'
          }`}>
            {feedback.message}
          </div>
        )}

        <div className="overflow-hidden rounded-3xl border border-[#d9d1be] bg-white shadow-sm">
          {loading ? (
            <p className="px-5 py-10 text-center text-sm text-[#68756c]">読み込み中…</p>
          ) : users.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-[#68756c]">登録ユーザーがいません。</p>
          ) : (
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-[#e6dfcf] bg-[#faf8f1] text-left text-[#68756c]">
                  <th className="px-4 py-3 font-medium">メールアドレス</th>
                  <th className="px-4 py-3 font-medium">現在のロール</th>
                  <th className="px-4 py-3 font-medium">変更</th>
                  <th className="px-4 py-3 font-medium">登録日</th>
                  <th className="px-4 py-3 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => {
                  const pendingRole = pendingRoles[u.uid] ?? u.role
                  const dirty = pendingRole !== u.role
                  return (
                    <tr key={u.uid} className="border-b border-[#f0ebdf] text-[#173c2a]">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <User2 size={14} className="text-[#68756c]" />
                          <span className="font-medium">{u.email || '(no email)'}</span>
                          {u.uid === user?.uid && (
                            <span className="rounded-full bg-[#eef3eb] px-2 py-0.5 text-[10px] text-[#174c33]">自分</span>
                          )}
                        </div>
                        <div className="mt-1 text-[11px] text-[#a59f8c] font-mono">{u.uid}</div>
                      </td>
                      <td className="px-4 py-3">
                        {u.role === 'admin' ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                            <ShieldCheck size={12} />
                            Admin
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                            Viewer
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={pendingRole}
                          onChange={e => handleRoleSelect(u.uid, e.target.value as 'admin' | 'viewer')}
                          disabled={u.uid === user?.uid}
                          className="rounded-lg border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600 disabled:bg-gray-50"
                        >
                          <option value="viewer">Viewer</option>
                          <option value="admin">Admin</option>
                        </select>
                      </td>
                      <td className="px-4 py-3 text-xs text-[#68756c]">{formatDate(u.createdAt)}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          {dirty && (
                            <button
                              type="button"
                              onClick={() => handleSave(u)}
                              disabled={savingUid === u.uid}
                              className="inline-flex items-center gap-1 rounded-lg bg-[#174c33] px-3 py-1 text-xs font-medium text-white transition hover:bg-[#205f43] disabled:opacity-60"
                            >
                              <Save size={12} />
                              {savingUid === u.uid ? '保存中…' : '保存'}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleDelete(u)}
                            disabled={u.uid === user?.uid}
                            aria-label="削除"
                            className="rounded-lg p-1.5 text-red-500 transition hover:bg-red-50 disabled:opacity-40 disabled:hover:bg-transparent"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {createOpen && (
          <CreateUserModal
            onClose={() => setCreateOpen(false)}
            onSubmit={handleCreate}
          />
        )}

        <div className="rounded-2xl border border-[#e6dfcf] bg-[#faf8f1] p-4 text-xs text-[#68756c]">
          <p className="font-medium text-[#173c2a]">ロールの違い</p>
          <ul className="mt-2 space-y-1 list-disc list-inside">
            <li><strong>Admin</strong>: 全ての操作（作成・編集・削除・設定変更・ユーザー管理）が可能</li>
            <li><strong>Viewer</strong>: 閲覧のみ。一覧・詳細表示は可能だが、登録・編集・削除は不可</li>
          </ul>
          <p className="mt-3">
            ユーザーを物理的に削除するには Firebase Console の Authentication 画面で行う必要があります。このページではロールを管理する Firestore ドキュメントのみ削除します。
          </p>
        </div>
      </div>
    </AppLayout>
  )
}
