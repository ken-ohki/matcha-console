'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AppLayout } from '@/components/layout/AppLayout'
import { useAuth } from '@/contexts/AuthContext'
import { getServices, type TermsSection } from '@/lib/services'
import { TERMS_AND_CONDITIONS_EN } from '@/lib/invoice'
import { ArrowDown, ArrowUp, Plus, Save, Settings, Trash2 } from 'lucide-react'

export default function SettingsTermsPage() {
  const [sections, setSections] = useState<TermsSection[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const load = async () => {
    setLoading(true)
    const services = await getServices()
    const stored = await services.settings.getDocumentTermsEn()
    if (stored.length > 0) {
      setSections(stored)
    } else {
      setSections(TERMS_AND_CONDITIONS_EN.map(s => ({ heading: s.heading, body: s.body })))
    }
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  const handleAdd = () => {
    setSections(prev => [...prev, { heading: '', body: '' }])
  }
  const handleRemove = (index: number) => {
    if (!confirm('このセクションを削除しますか？')) return
    setSections(prev => prev.filter((_, i) => i !== index))
  }
  const handleUpdate = (index: number, key: 'heading' | 'body', value: string) => {
    setSections(prev => prev.map((s, i) => (i === index ? { ...s, [key]: value } : s)))
  }
  const handleMove = (index: number, delta: -1 | 1) => {
    setSections(prev => {
      const next = [...prev]
      const target = index + delta
      if (target < 0 || target >= next.length) return prev
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  const handleSave = async () => {
    setSaving(true)
    setFeedback(null)
    try {
      const services = await getServices()
      const cleaned = sections
        .map(s => ({ heading: s.heading.trim(), body: s.body.trim() }))
        .filter(s => s.heading || s.body)
      await services.settings.updateDocumentTermsEn(cleaned)
      setFeedback({ tone: 'success', message: `${cleaned.length} セクションを保存しました` })
    } catch (err) {
      setFeedback({ tone: 'error', message: err instanceof Error ? err.message : '保存に失敗しました' })
    } finally {
      setSaving(false)
    }
  }

  const handleResetToDefault = () => {
    if (!confirm('デフォルトの内容で上書きします（保存はしません）。よろしいですか？')) return
    setSections(TERMS_AND_CONDITIONS_EN.map(s => ({ heading: s.heading, body: s.body })))
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
          <h1 className="mt-3 text-3xl font-bold text-ink">請求書 Terms &amp; Conditions of Sale</h1>
          <p className="mt-2 text-sm text-mist">
            英語版請求書に添付される Terms &amp; Conditions of Sale を編集できます。各セクションは見出しと本文で構成されます。
          </p>
        </div>

        <div className="flex flex-wrap gap-2 text-sm">
          <Link href="/settings/masters" className="rounded-full border border-line bg-white px-3 py-1.5 text-ink transition hover:bg-[#ece8db]">マスター管理</Link>
          <Link href="/settings/users" className="rounded-full border border-line bg-white px-3 py-1.5 text-ink transition hover:bg-[#ece8db]">ユーザー管理</Link>
          <Link href="/settings/terms" className="rounded-full bg-ink px-3 py-1.5 text-paper">請求書 T&amp;C</Link>
          <Link href="/settings/bank-accounts" className="rounded-full border border-line bg-white px-3 py-1.5 text-ink transition hover:bg-[#ece8db]">入金口座</Link>
          <Link href="/settings/issuer" className="rounded-full border border-line bg-white px-3 py-1.5 text-ink transition hover:bg-[#ece8db]">自社情報</Link>
          <Link href="/settings/wholesale" className="rounded-full border border-line bg-white px-3 py-1.5 text-ink transition hover:bg-[#ece8db]">卸売設定</Link>
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

        <div className="rounded-3xl border border-line bg-white p-5 shadow-sm">
          {loading ? (
            <p className="py-10 text-center text-sm text-mist">読み込み中…</p>
          ) : (
            <>
              <div className="mb-4 flex items-center justify-between">
                <p className="text-sm font-medium text-ink">{sections.length} セクション</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleResetToDefault}
                    className="rounded-xl border border-line bg-white px-3 py-1.5 text-xs font-medium text-graphite hover:bg-bone"
                  >
                    デフォルトに戻す
                  </button>
                  <button
                    type="button"
                    onClick={handleAdd}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-line bg-white px-3 py-1.5 text-xs font-medium text-matchaDeep hover:bg-[#eef3eb]"
                  >
                    <Plus size={14} />
                    セクションを追加
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                {sections.map((section, index) => (
                  <div key={index} className="rounded-2xl border border-[#e6dfcf] bg-bone p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-[11px] uppercase tracking-wider text-mist">セクション {index + 1}</span>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => handleMove(index, -1)}
                          disabled={index === 0}
                          aria-label="上へ"
                          className="rounded-lg p-1 text-mist transition hover:bg-gray-200 disabled:opacity-30"
                        >
                          <ArrowUp size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMove(index, 1)}
                          disabled={index === sections.length - 1}
                          aria-label="下へ"
                          className="rounded-lg p-1 text-mist transition hover:bg-gray-200 disabled:opacity-30"
                        >
                          <ArrowDown size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemove(index)}
                          aria-label="削除"
                          className="rounded-lg p-1 text-alert transition hover:bg-alert/5"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                    <input
                      type="text"
                      value={section.heading}
                      onChange={e => handleUpdate(index, 'heading', e.target.value)}
                      placeholder="見出し (例: 1. Definitions)"
                      className="mb-2 w-full rounded-lg border border-line bg-white px-3 py-2 text-sm font-medium text-ink focus:outline-none focus:ring-2 focus:ring-matcha"
                    />
                    <textarea
                      rows={4}
                      value={section.body}
                      onChange={e => handleUpdate(index, 'body', e.target.value)}
                      placeholder="本文 (英語)"
                      className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-[#1f2a23] focus:outline-none focus:ring-2 focus:ring-matcha"
                    />
                  </div>
                ))}
              </div>

              <div className="mt-5 flex justify-end">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-xl bg-ink px-4 py-2 text-sm font-medium text-paper shadow transition hover:bg-[#205f43] disabled:opacity-60"
                >
                  <Save size={14} />
                  {saving ? '保存中…' : '変更を保存'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </AppLayout>
  )
}
