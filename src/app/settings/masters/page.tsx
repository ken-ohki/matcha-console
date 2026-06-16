'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AppLayout } from '@/components/layout/AppLayout'
import { useAuth } from '@/contexts/AuthContext'
import { getServices } from '@/lib/services'
import type { MasterEntry, MasterEntryInput, MasterType } from '@/types'
import { Plus, Save, Settings, Trash2, X } from 'lucide-react'

const TYPE_TABS: { type: MasterType; label: string; description: string }[] = [
  { type: 'tea_type', label: '茶種', description: 'Tea types' },
  { type: 'grade', label: 'グレード', description: 'Grades' },
  { type: 'origin', label: '産地', description: 'Origins' },
  { type: 'cultivar', label: '品種', description: 'Cultivars' },
  { type: 'plucking', label: '摘採方法', description: 'Plucking methods' },
  { type: 'harvest', label: '摘採時期', description: 'Harvest seasons' },
  { type: 'shading', label: '被覆方法', description: 'Shading methods' },
  { type: 'certification', label: '認証', description: 'Certifications' },
  { type: 'terms', label: '取引条件', description: 'Sales / payment terms' },
  { type: 'shipping_method', label: '発送方法', description: 'Shipping methods' },
]

interface DraftRow {
  id: string | null
  englishName: string
  japaneseName: string
  sortOrder: number
  dirty: boolean
}

function toDraft(entry: MasterEntry): DraftRow {
  return {
    id: entry.id,
    englishName: entry.englishName,
    japaneseName: entry.japaneseName,
    sortOrder: entry.sortOrder,
    dirty: false,
  }
}

export default function SettingsMastersPage() {
  const [masters, setMasters] = useState<MasterEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [activeType, setActiveType] = useState<MasterType>('cultivar')
  const [drafts, setDrafts] = useState<DraftRow[]>([])
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)
  const { user } = useAuth()

  const load = async () => {
    setLoading(true)
    const services = await getServices()
    const next = await services.masters.listMasters()
    setMasters(next)
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  // Rebuild drafts when active type or masters change
  useEffect(() => {
    const next = masters
      .filter(m => m.type === activeType)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(toDraft)
    setDrafts(next)
  }, [masters, activeType])

  const isAdmin = user?.role === 'admin'

  const handleAddRow = () => {
    setDrafts(prev => [
      ...prev,
      {
        id: null,
        englishName: '',
        japaneseName: '',
        sortOrder: prev.length,
        dirty: true,
      },
    ])
  }

  const handleUpdateField = (index: number, key: 'englishName' | 'japaneseName', value: string) => {
    setDrafts(prev => prev.map((row, i) => (i === index ? { ...row, [key]: value, dirty: true } : row)))
  }

  const handleRemove = async (index: number) => {
    const row = drafts[index]
    if (!row) return
    if (row.id === null) {
      setDrafts(prev => prev.filter((_, i) => i !== index))
      return
    }
    if (!confirm(`「${row.englishName || row.japaneseName}」を削除しますか？`)) return
    try {
      const services = await getServices()
      await services.masters.deleteMaster(row.id)
      setFeedback({ tone: 'success', message: 'マスターを削除しました' })
      await load()
    } catch (err) {
      setFeedback({ tone: 'error', message: err instanceof Error ? err.message : '削除に失敗しました' })
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setFeedback(null)
    try {
      const services = await getServices()
      const dirtyRows = drafts.filter(row => row.dirty)
      for (const [index, row] of drafts.entries()) {
        if (!row.englishName.trim()) continue
        const baseInput: MasterEntryInput = {
          type: activeType,
          englishName: row.englishName.trim(),
          japaneseName: row.japaneseName.trim(),
          sortOrder: index,
        }
        if (row.id === null) {
          await services.masters.createMaster(baseInput)
        } else if (row.dirty) {
          await services.masters.updateMaster(row.id, baseInput)
        }
      }
      setFeedback({
        tone: 'success',
        message: dirtyRows.length === 0 ? '変更はありません' : `${dirtyRows.length} 件を保存しました`,
      })
      await load()
    } catch (err) {
      setFeedback({ tone: 'error', message: err instanceof Error ? err.message : '保存に失敗しました' })
    } finally {
      setSaving(false)
    }
  }

  const summary = useMemo(() => {
    const counts = new Map<MasterType, number>()
    for (const m of masters) counts.set(m.type, (counts.get(m.type) ?? 0) + 1)
    return counts
  }, [masters])

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-[#ece8ff] px-3 py-1 text-sm font-medium text-[#5e44a8]">
            <Settings size={15} />
            設定
          </div>
          <h1 className="mt-3 text-3xl font-bold text-[#173c2a]">マスター管理</h1>
          <p className="mt-2 text-sm text-[#68756c]">
            英語名（DB に保存される値）と日本語訳（管理画面の表示）を編集できます。カタログには英語名がそのまま使われます。
          </p>
        </div>

        <div className="flex flex-wrap gap-2 text-sm">
          <Link
            href="/settings/masters"
            className="rounded-full bg-[#174c33] px-3 py-1.5 text-white"
          >
            マスター管理
          </Link>
          {user?.role === 'admin' && (
            <>
              <Link
                href="/settings/users"
                className="rounded-full border border-[#d9d1be] bg-white px-3 py-1.5 text-[#173c2a] transition hover:bg-[#ece8db]"
              >
                ユーザー管理
              </Link>
              <Link
                href="/settings/terms"
                className="rounded-full border border-[#d9d1be] bg-white px-3 py-1.5 text-[#173c2a] transition hover:bg-[#ece8db]"
              >
                請求書 T&amp;C
              </Link>
              <Link
                href="/settings/bank-accounts"
                className="rounded-full border border-[#d9d1be] bg-white px-3 py-1.5 text-[#173c2a] transition hover:bg-[#ece8db]"
              >
                入金口座
              </Link>
              <Link
                href="/settings/issuer"
                className="rounded-full border border-[#d9d1be] bg-white px-3 py-1.5 text-[#173c2a] transition hover:bg-[#ece8db]"
              >
                自社情報
              </Link>
              <Link
                href="/settings/wholesale"
                className="rounded-full border border-[#d9d1be] bg-white px-3 py-1.5 text-[#173c2a] transition hover:bg-[#ece8db]"
              >
                卸売設定
              </Link>
            </>
          )}
        </div>

        <div className="overflow-x-auto rounded-3xl border border-[#d9d1be] bg-white shadow-sm">
          <div className="flex min-w-max border-b border-gray-200">
            {TYPE_TABS.map(tab => (
              <button
                key={tab.type}
                type="button"
                onClick={() => setActiveType(tab.type)}
                className={`flex shrink-0 items-center gap-2 border-b-2 px-5 py-3 text-sm font-medium -mb-px transition-colors ${
                  activeType === tab.type
                    ? 'border-[#174c33] text-[#174c33]'
                    : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'
                }`}
              >
                {tab.label}
                <span className="text-xs text-gray-400">({summary.get(tab.type) ?? 0})</span>
              </button>
            ))}
          </div>

          <div className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-[#173c2a]">
                  {TYPE_TABS.find(t => t.type === activeType)?.label}
                </h2>
                <p className="text-xs text-[#68756c]">
                  {TYPE_TABS.find(t => t.type === activeType)?.description}
                </p>
              </div>
              {isAdmin && (
                <button
                  type="button"
                  onClick={handleAddRow}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-[#d9d1be] bg-white px-3 py-1.5 text-sm font-medium text-[#174c33] transition hover:bg-[#eef3eb]"
                >
                  <Plus size={14} />
                  追加
                </button>
              )}
            </div>

            {loading ? (
              <p className="py-10 text-center text-sm text-[#68756c]">読み込み中…</p>
            ) : drafts.length === 0 ? (
              <p className="py-10 text-center text-sm text-[#68756c]">登録されていません。</p>
            ) : (
              <div className="space-y-2">
                <div className="hidden grid-cols-[1fr_1fr_60px_60px] gap-3 px-3 text-[11px] uppercase tracking-wider text-[#68756c] md:grid">
                  <span>英語名（DB に保存）</span>
                  <span>日本語名（表示）</span>
                  <span className="text-center">並び順</span>
                  <span></span>
                </div>
                {drafts.map((row, index) => (
                  <div
                    key={row.id ?? `new-${index}`}
                    className={`grid grid-cols-1 gap-2 rounded-xl border px-3 py-2 md:grid-cols-[1fr_1fr_60px_60px] md:items-center ${
                      row.dirty ? 'border-amber-300 bg-amber-50/50' : 'border-[#e6dfcf] bg-white'
                    }`}
                  >
                    <input
                      type="text"
                      value={row.englishName}
                      onChange={e => handleUpdateField(index, 'englishName', e.target.value)}
                      placeholder="例: Yabukita"
                      disabled={!isAdmin}
                      className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600 disabled:bg-gray-50"
                    />
                    <input
                      type="text"
                      value={row.japaneseName}
                      onChange={e => handleUpdateField(index, 'japaneseName', e.target.value)}
                      placeholder="例: やぶきた"
                      disabled={!isAdmin}
                      className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600 disabled:bg-gray-50"
                    />
                    <span className="text-center text-xs text-gray-500">{index + 1}</span>
                    {isAdmin && (
                      <button
                        type="button"
                        onClick={() => handleRemove(index)}
                        aria-label="削除"
                        className="justify-self-center rounded-lg p-1.5 text-red-500 transition hover:bg-red-50"
                      >
                        {row.id === null ? <X size={16} /> : <Trash2 size={16} />}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {isAdmin && (
              <div className="mt-5 flex items-center justify-between">
                {feedback && (
                  <p className={`text-sm ${feedback.tone === 'success' ? 'text-emerald-700' : 'text-red-600'}`}>
                    {feedback.message}
                  </p>
                )}
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="ml-auto inline-flex items-center gap-2 rounded-xl bg-[#174c33] px-4 py-2 text-sm font-medium text-white shadow transition hover:bg-[#205f43] disabled:opacity-60"
                >
                  <Save size={14} />
                  {saving ? '保存中…' : '変更を保存'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  )
}
