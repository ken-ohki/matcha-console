'use client'

import { useEffect, useState } from 'react'
import { AppLayout } from '@/components/layout/AppLayout'
import { SettingsNav } from '@/components/settings/SettingsNav'
import { useAuth } from '@/contexts/AuthContext'
import { useConfirm } from '@/contexts/ConfirmContext'
import { getServices } from '@/lib/services'
import {
  EMAIL_EVENTS,
  EMAIL_PLACEHOLDERS,
  DEFAULT_EMAIL_TEMPLATES,
  type EmailEventKey,
  type EmailTemplate,
} from '@/lib/emailTemplates'
import { Save, Settings } from 'lucide-react'

type TemplateMap = Record<EmailEventKey, EmailTemplate>

export default function SettingsEmailsPage() {
  const [form, setForm] = useState<TemplateMap>(DEFAULT_EMAIL_TEMPLATES)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)
  const { user } = useAuth()
  const { confirm } = useConfirm()
  const isAdmin = user?.role === 'admin'

  useEffect(() => {
    void (async () => {
      setLoading(true)
      const services = await getServices()
      setForm(await services.settings.getEmailTemplates())
      setLoading(false)
    })()
  }, [])

  const setField = (key: EmailEventKey, field: keyof EmailTemplate, value: string) =>
    setForm(prev => ({ ...prev, [key]: { ...prev[key], [field]: value } }))

  const resetOne = async (key: EmailEventKey) => {
    if (!(await confirm({ message: 'この文面を初期値に戻します（保存はしません）。よろしいですか？', danger: true, confirmLabel: 'OK' }))) return
    setForm(prev => ({ ...prev, [key]: { ...DEFAULT_EMAIL_TEMPLATES[key] } }))
  }

  const handleSave = async () => {
    setSaving(true)
    setFeedback(null)
    try {
      const services = await getServices()
      const cleaned = {} as TemplateMap
      for (const e of EMAIL_EVENTS) {
        cleaned[e.key] = { subject: form[e.key].subject.trim(), body: form[e.key].body.trim() }
      }
      await services.settings.updateEmailTemplates(cleaned)
      setFeedback({ tone: 'success', message: 'メール文面を保存しました' })
    } catch (err) {
      setFeedback({ tone: 'error', message: err instanceof Error ? err.message : '保存に失敗しました' })
    } finally {
      setSaving(false)
    }
  }

  if (!isAdmin) {
    return (
      <AppLayout>
        <div className="rounded-2xl border border-dashed border-line bg-white p-10 text-center text-sm text-mist">
          このページは管理者のみアクセスできます。
        </div>
      </AppLayout>
    )
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-[#ece8ff] px-3 py-1 text-sm font-medium text-graphite">
            <Settings size={15} />
            設定
          </div>
          <h1 className="mt-3 text-3xl font-bold text-ink">メール文面</h1>
          <p className="mt-2 text-sm text-mist">
            自動送付メールの件名・本文（文章部分）を編集します。注文明細・振込先・追跡情報・添付書類などの定型ブロックは自動で付加されます。
          </p>
        </div>

        <SettingsNav active="emails" />

        <div className="rounded-xl border border-line bg-bone px-4 py-3 text-xs text-graphite">
          <p className="mb-1 font-medium text-ink">使用できる差し込み（プレースホルダ）</p>
          <ul className="grid gap-x-6 gap-y-0.5 sm:grid-cols-2">
            {EMAIL_PLACEHOLDERS.map(p => (
              <li key={p.token}><code className="rounded bg-white px-1">{p.token}</code> — {p.desc}</li>
            ))}
          </ul>
        </div>

        {feedback && (
          <div className={`rounded-xl border px-4 py-3 text-sm ${
            feedback.tone === 'success'
              ? 'border-matcha/40 bg-bone text-matcha'
              : 'border-alert/40 bg-alert/5 text-alert'
          }`}>
            {feedback.message}
          </div>
        )}

        {loading ? (
          <p className="py-10 text-center text-sm text-mist">読み込み中…</p>
        ) : (
          <div className="space-y-4">
            {EMAIL_EVENTS.map(e => (
              <div key={e.key} className="rounded-3xl border border-line bg-white p-5 shadow-sm">
                <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h2 className="text-base font-semibold text-ink">{e.label}</h2>
                    <p className="mt-0.5 text-xs text-mist">{e.description}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => resetOne(e.key)}
                    className="shrink-0 rounded-lg border border-line bg-white px-2.5 py-1 text-xs font-medium text-graphite hover:bg-bone"
                  >
                    初期値に戻す
                  </button>
                </div>
                <label className="mb-1 block text-sm font-medium text-ink">件名</label>
                <input
                  type="text"
                  value={form[e.key].subject}
                  onChange={ev => setField(e.key, 'subject', ev.target.value)}
                  className="mb-3 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-matcha"
                />
                <label className="mb-1 block text-sm font-medium text-ink">本文（HTML可）</label>
                <textarea
                  rows={5}
                  value={form[e.key].body}
                  onChange={ev => setField(e.key, 'body', ev.target.value)}
                  className="w-full rounded-xl border border-line bg-white px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-matcha"
                />
              </div>
            ))}
          </div>
        )}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || loading}
            className="inline-flex items-center gap-2 rounded-xl bg-ink px-4 py-2 text-sm font-medium text-paper shadow transition hover:bg-[#205f43] disabled:opacity-60"
          >
            <Save size={14} />
            {saving ? '保存中…' : '変更を保存'}
          </button>
        </div>
      </div>
    </AppLayout>
  )
}
