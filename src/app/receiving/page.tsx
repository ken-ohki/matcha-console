'use client'

import { useEffect, useMemo, useState } from 'react'
import { AppLayout } from '@/components/layout/AppLayout'
import { useAuth } from '@/contexts/AuthContext'
import { getServices } from '@/lib/services'
import type {
  InventoryGroup,
  ProductInput,
  ProductWithInventory,
  PurchaseOrder,
} from '@/types'
import { PackageOpen, Check, Undo2, X } from 'lucide-react'

function formatKg(value: number): string {
  return `${new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 1 }).format(value)} kg`
}

function todayIso(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

interface PendingLine {
  order: PurchaseOrder
  lineIndex: number
}

interface ReceivedLine {
  order: PurchaseOrder
  lineIndex: number
}

function isLineReceived(order: PurchaseOrder, lineIndex: number): boolean {
  const item = order.items[lineIndex]
  if (!item) return false
  // A line counts as received if its receivedKg covers the quantity, OR (for POs
  // created before the receiving flow existed) it is linked to a product and the
  // whole PO was already marked '受領済' — those legacy items lack receivedKg.
  if (item.receivedKg >= item.quantityKg && item.quantityKg > 0) return true
  if (item.productId && order.status === 'received') return true
  return false
}

function UnlistedBadge() {
  return (
    <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
      未登録
    </span>
  )
}

function ReceiveModal({
  open,
  pending,
  products,
  inventoryGroups,
  onClose,
  onConfirm,
}: {
  open: boolean
  pending: PendingLine | null
  products: ProductWithInventory[]
  inventoryGroups: InventoryGroup[]
  onClose: () => void
  onConfirm: (opts: {
    arrivalDate: string
    mapping:
      | { kind: 'existing'; productId: string }
      | { kind: 'new'; product: ProductInput }
  }) => Promise<void>
}) {
  const line = pending ? pending.order.items[pending.lineIndex] : null
  const isUnlisted = !!line && !line.productId

  const [arrivalDate, setArrivalDate] = useState(todayIso())
  const [mode, setMode] = useState<'new' | 'existing'>('new')
  const [newName, setNewName] = useState('')
  const [newSku, setNewSku] = useState('')
  const [newGroupId, setNewGroupId] = useState('')
  const [newUnitPrice, setNewUnitPrice] = useState(0)
  const [existingProductId, setExistingProductId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open || !pending || !line) return
    setArrivalDate(pending.order.expectedDeliveryDate || todayIso())
    setMode('new')
    setNewName(line.productName ?? '')
    setNewSku((line.productName ?? '').trim().slice(0, 24))
    setNewGroupId(inventoryGroups[0]?.id ?? '')
    setNewUnitPrice(Number(line.unitPrice) || 0)
    setExistingProductId(products[0]?.id ?? '')
    setError('')
  }, [open, pending, line, inventoryGroups, products])

  if (!open || !pending || !line) return null

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      if (!arrivalDate.trim()) {
        setError('入荷日を入力してください')
        return
      }
      // Listed line: just record the arrival against its existing product.
      if (!isUnlisted) {
        await onConfirm({ arrivalDate: arrivalDate.trim(), mapping: { kind: 'existing', productId: line.productId } })
        onClose()
        return
      }
      if (mode === 'existing') {
        if (!existingProductId) {
          setError('紐付ける商品を選択してください')
          return
        }
        await onConfirm({ arrivalDate: arrivalDate.trim(), mapping: { kind: 'existing', productId: existingProductId } })
        onClose()
        return
      }
      // New product mapping.
      if (!newName.trim()) {
        setError('商品名を入力してください')
        return
      }
      if (!newSku.trim()) {
        setError('SKUを入力してください')
        return
      }
      if (!newGroupId) {
        setError('在庫グループを選択してください')
        return
      }
      const product: ProductInput = {
        sku: newSku.trim(),
        name: newName.trim(),
        origins: [],
        cultivars: [],
        pluckingMethods: [],
        harvestSeasons: [],
        shadingMethods: [],
        certifications: [],
        arrivalRecords: [],
        inventoryChecks: [],
        arrivalDate: '',
        inventoryGroupId: newGroupId,
        initialStockKg: 0,
        purchaseUnitPrice: Number(newUnitPrice) || 0,
        showInCatalog: true,
      }
      await onConfirm({ arrivalDate: arrivalDate.trim(), mapping: { kind: 'new', product } })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '入荷処理に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-5 shadow-xl sm:rounded-3xl sm:p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-[#173c2a]">入荷登録</h2>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 text-[#68756c] hover:bg-[#f7f5ee]">
            <X size={18} />
          </button>
        </div>

        <div className="mb-4 rounded-2xl border border-[#e6dfcf] bg-[#faf8f2] p-3 text-sm">
          <div className="flex items-center gap-2 font-medium text-[#173c2a]">
            {line.productName || '-'}
            {isUnlisted && <UnlistedBadge />}
          </div>
          <div className="mt-1 text-xs text-[#68756c]">
            {pending.order.supplierName}・{formatKg(line.quantityKg)}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">入荷日</label>
            <input
              type="date"
              value={arrivalDate}
              onChange={e => setArrivalDate(e.target.value)}
              className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
            />
          </div>

          {isUnlisted && (
            <div className="space-y-3">
              <div className="flex flex-col gap-2 rounded-2xl border border-[#e6dfcf] p-3">
                <label className="flex items-center gap-2 text-sm font-medium text-[#173c2a]">
                  <input type="radio" checked={mode === 'new'} onChange={() => setMode('new')} />
                  新規商品として登録
                </label>
                {mode === 'new' && (
                  <div className="space-y-2 pl-6">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-gray-700">商品名</label>
                      <input
                        type="text"
                        value={newName}
                        onChange={e => setNewName(e.target.value)}
                        className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-gray-700">SKU</label>
                      <input
                        type="text"
                        value={newSku}
                        onChange={e => setNewSku(e.target.value)}
                        className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-gray-700">在庫グループ</label>
                      <select
                        value={newGroupId}
                        onChange={e => setNewGroupId(e.target.value)}
                        className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                      >
                        <option value="">選択してください</option>
                        {inventoryGroups.map(g => (
                          <option key={g.id} value={g.id}>{g.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-gray-700">仕入単価</label>
                      <input
                        type="number"
                        value={newUnitPrice}
                        onChange={e => setNewUnitPrice(Number(e.target.value) || 0)}
                        className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-2 rounded-2xl border border-[#e6dfcf] p-3">
                <label className="flex items-center gap-2 text-sm font-medium text-[#173c2a]">
                  <input type="radio" checked={mode === 'existing'} onChange={() => setMode('existing')} />
                  既存商品に紐付け
                </label>
                {mode === 'existing' && (
                  <div className="pl-6">
                    <select
                      value={existingProductId}
                      onChange={e => setExistingProductId(e.target.value)}
                      className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
                    >
                      <option value="">選択してください</option>
                      {products.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-[#d9d1be] px-4 py-2.5 text-sm font-medium text-[#173c2a] hover:bg-[#f7f5ee]"
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 rounded-xl bg-[#174c33] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#173c2a] disabled:opacity-60"
            >
              {saving ? '処理中…' : '入荷を登録'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function ReceivingPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [products, setProducts] = useState<ProductWithInventory[]>([])
  const [inventoryGroups, setInventoryGroups] = useState<InventoryGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [showReceived, setShowReceived] = useState(false)
  const [modalTarget, setModalTarget] = useState<PendingLine | null>(null)
  const [modalOpen, setModalOpen] = useState(false)

  const load = async () => {
    setLoading(true)
    const services = await getServices()
    const [nextOrders, nextProducts, nextGroups] = await Promise.all([
      services.purchaseOrders.getPurchaseOrders(),
      services.inventory.getProductsWithInventory(),
      services.inventory.getInventoryGroups(),
    ])
    setOrders(nextOrders)
    setProducts(nextProducts)
    setInventoryGroups(nextGroups)
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', handler)
    window.addEventListener('focus', handler)
    return () => {
      document.removeEventListener('visibilitychange', handler)
      window.removeEventListener('focus', handler)
    }
  }, [])

  const pendingLines = useMemo<PendingLine[]>(() => {
    const result: PendingLine[] = []
    for (const order of orders) {
      if (order.status === 'cancelled') continue
      order.items.forEach((_, lineIndex) => {
        if (!isLineReceived(order, lineIndex)) {
          result.push({ order, lineIndex })
        }
      })
    }
    return result.sort((a, b) => {
      const da = a.order.expectedDeliveryDate || a.order.orderDate
      const db = b.order.expectedDeliveryDate || b.order.orderDate
      return da.localeCompare(db)
    })
  }, [orders])

  const receivedLines = useMemo<ReceivedLine[]>(() => {
    const result: ReceivedLine[] = []
    for (const order of orders) {
      if (order.status === 'cancelled') continue
      order.items.forEach((_, lineIndex) => {
        if (isLineReceived(order, lineIndex)) {
          result.push({ order, lineIndex })
        }
      })
    }
    return result.sort((a, b) => b.order.updatedAt.getTime() - a.order.updatedAt.getTime()).slice(0, 30)
  }, [orders])

  const openReceive = (target: PendingLine) => {
    setModalTarget(target)
    setModalOpen(true)
  }

  const handleConfirm = async (opts: {
    arrivalDate: string
    mapping:
      | { kind: 'existing'; productId: string }
      | { kind: 'new'; product: ProductInput }
  }) => {
    if (!modalTarget) return
    const services = await getServices()
    await services.purchaseOrders.receivePurchaseOrderLine(modalTarget.order.id, modalTarget.lineIndex, opts)
    await load()
  }

  const handleUnreceive = async (target: ReceivedLine) => {
    if (!confirm('この明細の入荷を取り消しますか？（在庫から差し引かれます）')) return
    const services = await getServices()
    await services.purchaseOrders.unreceivePurchaseOrderLine(target.order.id, target.lineIndex)
    await load()
  }

  return (
    <AppLayout>
      <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8">
        <div className="mb-6 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <PackageOpen size={22} className="text-[#174c33]" />
            <h1 className="text-2xl font-bold text-[#173c2a]">入荷管理</h1>
          </div>
          <p className="text-sm text-[#68756c]">
            発注した商品の入荷を登録します。在庫未登録の商品は入荷時に新規登録または既存商品への紐付けができます。
          </p>
          <div className="mt-1">
            <span className="inline-flex items-center rounded-full bg-[#173c2a] px-3 py-1 text-sm font-medium text-white">
              入荷待ち {pendingLines.length}件
            </span>
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-[#68756c]">読み込み中…</p>
        ) : (
          <>
            <div className="overflow-hidden rounded-3xl border border-[#e6dfcf] bg-white">
              <table className="w-full text-sm">
                <thead className="bg-[#f7f5ee] text-left text-xs uppercase tracking-wider text-[#68756c]">
                  <tr>
                    <th className="px-4 py-3">発注日</th>
                    <th className="px-4 py-3">仕入先</th>
                    <th className="px-4 py-3">商品</th>
                    <th className="px-4 py-3">数量</th>
                    <th className="px-4 py-3">入荷予定日</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {pendingLines.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-[#68756c]">入荷待ちの商品はありません</td>
                    </tr>
                  ) : (
                    pendingLines.map(({ order, lineIndex }) => {
                      const item = order.items[lineIndex]
                      return (
                        <tr key={`${order.id}:${lineIndex}`} className="border-t border-[#f0ebdf]">
                          <td className="px-4 py-3 text-[#173c2a]">{order.orderDate || '-'}</td>
                          <td className="px-4 py-3 text-[#173c2a]">{order.supplierName}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2 text-[#173c2a]">
                              {item.productName || '-'}
                              {!item.productId && <UnlistedBadge />}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-[#173c2a]">{formatKg(item.quantityKg)}</td>
                          <td className="px-4 py-3 text-[#68756c]">{order.expectedDeliveryDate || '-'}</td>
                          <td className="px-4 py-3 text-right">
                            {isAdmin && (
                              <button
                                type="button"
                                onClick={() => openReceive({ order, lineIndex })}
                                className="inline-flex items-center gap-1 rounded-xl bg-[#174c33] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#173c2a]"
                              >
                                <Check size={14} />
                                入荷
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-6">
              <button
                type="button"
                onClick={() => setShowReceived(prev => !prev)}
                className="text-sm font-medium text-[#174c33] hover:underline"
              >
                入荷済み（{receivedLines.length}件）{showReceived ? 'を隠す' : 'を表示'}
              </button>
              {showReceived && (
                <div className="mt-3 overflow-hidden rounded-3xl border border-[#e6dfcf] bg-white">
                  <table className="w-full text-sm">
                    <thead className="bg-[#f7f5ee] text-left text-xs uppercase tracking-wider text-[#68756c]">
                      <tr>
                        <th className="px-4 py-3">仕入先</th>
                        <th className="px-4 py-3">商品</th>
                        <th className="px-4 py-3">数量</th>
                        <th className="px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {receivedLines.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-4 py-8 text-center text-[#68756c]">入荷済みの商品はありません</td>
                        </tr>
                      ) : (
                        receivedLines.map(({ order, lineIndex }) => {
                          const item = order.items[lineIndex]
                          return (
                            <tr key={`${order.id}:${lineIndex}`} className="border-t border-[#f0ebdf]">
                              <td className="px-4 py-3 text-[#173c2a]">{order.supplierName}</td>
                              <td className="px-4 py-3 text-[#173c2a]">{item.productName || '-'}</td>
                              <td className="px-4 py-3 text-[#173c2a]">{formatKg(item.quantityKg)}</td>
                              <td className="px-4 py-3 text-right">
                                {isAdmin && (
                                  <button
                                    type="button"
                                    onClick={() => handleUnreceive({ order, lineIndex })}
                                    className="inline-flex items-center gap-1 rounded-xl border border-[#d9d1be] px-3 py-1.5 text-xs font-medium text-[#173c2a] hover:bg-[#f7f5ee]"
                                  >
                                    <Undo2 size={14} />
                                    取消
                                  </button>
                                )}
                              </td>
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <ReceiveModal
        open={modalOpen}
        pending={modalTarget}
        products={products}
        inventoryGroups={inventoryGroups}
        onClose={() => setModalOpen(false)}
        onConfirm={handleConfirm}
      />
    </AppLayout>
  )
}
