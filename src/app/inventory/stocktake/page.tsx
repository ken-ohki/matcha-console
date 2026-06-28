'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Printer } from 'lucide-react'
import { getServices } from '@/lib/services'
import type { InventoryGroup, ProductWithInventory } from '@/types'
import { formatKg, todayIso } from '@/lib/format'
import { EmptyState } from '@/components/ui/EmptyState'

interface GroupSection {
  name: string
  items: ProductWithInventory[]
}

export default function StocktakeSheetPage() {
  const [products, setProducts] = useState<ProductWithInventory[]>([])
  const [groups, setGroups] = useState<InventoryGroup[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const svc = await getServices()
        const [ps, gs] = await Promise.all([
          svc.inventory.getProductsWithInventory(),
          svc.inventory.getInventoryGroups(),
        ])
        if (!active) return
        setProducts(ps)
        setGroups(gs)
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [])

  // Group active (non-archived) products by inventory group for shelf-by-shelf counting.
  const sections = useMemo<GroupSection[]>(() => {
    const counted = products.filter(p => !p.archived)
    const sortItems = (items: ProductWithInventory[]) =>
      [...items].sort((a, b) => (a.sortOrder - b.sortOrder) || a.name.localeCompare(b.name, 'ja'))
    const known = new Set(groups.map(g => g.id))
    const out: GroupSection[] = groups
      .map(g => ({ name: g.name, items: sortItems(counted.filter(p => p.inventoryGroupId === g.id)) }))
      .filter(s => s.items.length > 0)
    const ungrouped = sortItems(counted.filter(p => !known.has(p.inventoryGroupId)))
    if (ungrouped.length > 0) out.push({ name: '未分類', items: ungrouped })
    return out
  }, [products, groups])

  const total = sections.reduce((s, g) => s + g.items.length, 0)

  return (
    <div className="min-h-screen bg-bone">
      <div className="no-print sticky top-0 z-20 border-b border-line bg-white shadow-sm">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <Link href="/inventory" className="inline-flex items-center gap-1 text-sm text-mist hover:text-ink">
            <ArrowLeft size={14} /> 在庫管理に戻る
          </Link>
          <span className="text-sm text-mist">在庫管理表（棚卸表）</span>
          <button
            type="button"
            onClick={() => window.print()}
            disabled={loading || total === 0}
            className="ml-auto inline-flex items-center gap-1.5 rounded-xl bg-ink px-3 py-2 text-sm font-medium text-paper shadow transition hover:bg-[#205f43] disabled:opacity-50"
          >
            <Printer size={14} /> 印刷 / PDF
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-4 py-6 print:p-0 print:max-w-none">
        {loading ? (
          <p className="py-20 text-center text-sm text-mist">読み込み中…</p>
        ) : total === 0 ? (
          <EmptyState message="対象の商品がありません。" />
        ) : (
          <div className="rounded-lg border border-line bg-white p-6 shadow-sm print:border-0 print:p-0 print:shadow-none">
            <div className="mb-4 flex items-end justify-between">
              <div>
                <h1 className="text-xl font-bold tracking-wide text-ink">在庫管理表（棚卸表）</h1>
                <p className="mt-1 text-xs text-mist">商品 {total} 件</p>
              </div>
              <div className="text-right text-xs text-ink">
                <div>出力日: {todayIso()}</div>
                <div className="mt-1">担当者: ______________</div>
              </div>
            </div>

            <table className="w-full table-fixed border-collapse text-[10px]">
              <colgroup>
                <col style={{ width: '23%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '15%' }} />
                <col style={{ width: '21%' }} />
                <col style={{ width: '11%' }} />
                <col style={{ width: '9%' }} />
                <col style={{ width: '9%' }} />
              </colgroup>
              <thead>
                <tr className="bg-bone text-left text-ink">
                  <th className="border border-line px-1.5 py-1.5 font-medium">商品名</th>
                  <th className="border border-line px-1.5 py-1.5 font-medium">SKU</th>
                  <th className="border border-line px-1.5 py-1.5 font-medium">仕入先</th>
                  <th className="border border-line px-1.5 py-1.5 font-medium">仕入商品名</th>
                  <th className="border border-line px-1.5 py-1.5 text-right font-medium">システム在庫</th>
                  <th className="border border-line px-1.5 py-1.5 text-center font-medium">実際在庫</th>
                  <th className="border border-line px-1.5 py-1.5 text-center font-medium">確認日</th>
                </tr>
              </thead>
              <tbody>
                {sections.map(section => (
                  <Fragment key={section.name}>
                    <tr className="bg-[#f0ebdf]">
                      <td colSpan={7} className="border border-line px-2 py-1 font-semibold text-ink">
                        {section.name}（{section.items.length}件）
                      </td>
                    </tr>
                    {section.items.map(p => (
                      <tr key={p.id} className="text-ink">
                        <td className="break-words border border-line px-1.5 py-2 align-top">{p.name}</td>
                        <td className="break-all border border-line px-1.5 py-2 align-top font-mono text-[9px]">{p.sku || '—'}</td>
                        <td className="break-words border border-line px-1.5 py-2 align-top">{p.supplier || '—'}</td>
                        <td className="break-words border border-line px-1.5 py-2 align-top">{p.purchaseProductName || '—'}</td>
                        <td className="border border-line px-1.5 py-2 text-right align-top">{formatKg(p.currentStockKg)}</td>
                        <td className="border border-line px-1.5 py-2"></td>
                        <td className="border border-line px-1.5 py-2"></td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <style jsx global>{`
        @media print {
          @page { size: A4 portrait; margin: 12mm 10mm; }
          html, body {
            background: white !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
            color: #000 !important;
          }
          .no-print { display: none !important; }
          table { width: 100% !important; }
          thead { display: table-header-group; }
          tr { page-break-inside: avoid; }
        }
      `}</style>
    </div>
  )
}
