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
import { PackageOpen, Check, Undo2, X, FilePlus, Trash2 } from 'lucide-react'
import { formatKg, todayIso } from '@/lib/format'
import { computeTax } from '@/lib/tax'

interface PendingLine {
  order: PurchaseOrder
  lineIndex: number
}

interface OrphanArrival {
  product: ProductWithInventory
  arrival: { id: string; arrivalDate: string; quantityKg: number }
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
    <span className="inline-flex items-center rounded-full bg-bone px-2 py-0.5 text-[10px] font-medium text-[#a87b1e]">
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
          <h2 className="text-lg font-bold text-ink">入荷登録</h2>
          <button type="button" onClick={onClose} className="rounded-full p-1.5 text-mist hover:bg-bone">
            <X size={18} />
          </button>
        </div>

        <div className="mb-4 rounded-2xl border border-[#e6dfcf] bg-bone p-3 text-sm">
          <div className="flex items-center gap-2 font-medium text-ink">
            {line.productName || '-'}
            {isUnlisted && <UnlistedBadge />}
          </div>
          <div className="mt-1 text-xs text-mist">
            {pending.order.supplierName}・{formatKg(line.quantityKg)}
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-graphite">入荷日</label>
            <input
              type="date"
              value={arrivalDate}
              onChange={e => setArrivalDate(e.target.value)}
              className="w-full rounded-xl border border-line px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-matcha"
            />
          </div>

          {isUnlisted && (
            <div className="space-y-3">
              <div className="flex flex-col gap-2 rounded-2xl border border-[#e6dfcf] p-3">
                <label className="flex items-center gap-2 text-sm font-medium text-ink">
                  <input type="radio" checked={mode === 'new'} onChange={() => setMode('new')} />
                  新規商品として登録
                </label>
                {mode === 'new' && (
                  <div className="space-y-2 pl-6">
                    <div>
                      <label className="mb-1 block text-xs font-medium text-graphite">商品名</label>
                      <input
                        type="text"
                        value={newName}
                        onChange={e => setNewName(e.target.value)}
                        className="w-full rounded-xl border border-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-matcha"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-graphite">SKU</label>
                      <input
                        type="text"
                        value={newSku}
                        onChange={e => setNewSku(e.target.value)}
                        className="w-full rounded-xl border border-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-matcha"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-graphite">在庫グループ</label>
                      <select
                        value={newGroupId}
                        onChange={e => setNewGroupId(e.target.value)}
                        className="w-full rounded-xl border border-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-matcha"
                      >
                        <option value="">選択してください</option>
                        {inventoryGroups.map(g => (
                          <option key={g.id} value={g.id}>{g.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-medium text-graphite">仕入単価</label>
                      <input
                        type="number"
                        value={newUnitPrice}
                        onChange={e => setNewUnitPrice(Number(e.target.value) || 0)}
                        className="w-full rounded-xl border border-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-matcha"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-2 rounded-2xl border border-[#e6dfcf] p-3">
                <label className="flex items-center gap-2 text-sm font-medium text-ink">
                  <input type="radio" checked={mode === 'existing'} onChange={() => setMode('existing')} />
                  既存商品に紐付け
                </label>
                {mode === 'existing' && (
                  <div className="pl-6">
                    <select
                      value={existingProductId}
                      onChange={e => setExistingProductId(e.target.value)}
                      className="w-full rounded-xl border border-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-matcha"
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

          {error && <p className="text-sm text-alert">{error}</p>}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-ink hover:bg-bone"
            >
              キャンセル
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 rounded-xl bg-ink px-4 py-2.5 text-sm font-medium text-paper hover:bg-ink disabled:opacity-60"
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
  const [showOrphans, setShowOrphans] = useState(true)
  const [modalTarget, setModalTarget] = useState<PendingLine | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [orphanTarget, setOrphanTarget] = useState<OrphanArrival | null>(null)

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
      if (modalOpen || orphanTarget) return
      if (document.visibilityState === 'visible') void load()
    }
    document.addEventListener('visibilitychange', handler)
    window.addEventListener('focus', handler)
    return () => {
      document.removeEventListener('visibilitychange', handler)
      window.removeEventListener('focus', handler)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modalOpen, orphanTarget])

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

  const orphanArrivals = useMemo<OrphanArrival[]>(() => {
    const result: OrphanArrival[] = []
    for (const product of products) {
      for (const arrival of product.arrivalRecords ?? []) {
        if (!arrival?.id) continue
        if (arrival.id.startsWith('po:')) continue
        if (arrival.id.startsWith('legacy-')) continue
        result.push({ product, arrival })
      }
    }
    return result.sort((a, b) => (b.arrival.arrivalDate || '').localeCompare(a.arrival.arrivalDate || ''))
  }, [products])

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
            <PackageOpen size={22} className="text-matchaDeep" />
            <h1 className="text-2xl font-bold text-ink">入荷管理</h1>
          </div>
          <p className="text-sm text-mist">
            発注した商品の入荷を登録します。在庫未登録の商品は入荷時に新規登録または既存商品への紐付けができます。
          </p>
          <div className="mt-1">
            <span className="inline-flex items-center rounded-full bg-ink px-3 py-1 text-sm font-medium text-paper">
              入荷待ち {pendingLines.length}件
            </span>
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-mist">読み込み中…</p>
        ) : (
          <>
            <div className="overflow-hidden rounded-3xl border border-[#e6dfcf] bg-white">
              <table className="w-full text-sm">
                <thead className="bg-bone text-left text-xs uppercase tracking-wider text-mist">
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
                      <td colSpan={6} className="px-4 py-8 text-center text-mist">入荷待ちの商品はありません</td>
                    </tr>
                  ) : (
                    pendingLines.map(({ order, lineIndex }) => {
                      const item = order.items[lineIndex]
                      return (
                        <tr key={`${order.id}:${lineIndex}`} className="border-t border-[#f0ebdf]">
                          <td className="px-4 py-3 text-ink">{order.orderDate || '-'}</td>
                          <td className="px-4 py-3 text-ink">{order.supplierName}</td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2 text-ink">
                              {item.productName || '-'}
                              {!item.productId && <UnlistedBadge />}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-ink">{formatKg(item.quantityKg)}</td>
                          <td className="px-4 py-3 text-mist">{order.expectedDeliveryDate || '-'}</td>
                          <td className="px-4 py-3 text-right">
                            {isAdmin && (
                              <button
                                type="button"
                                onClick={() => openReceive({ order, lineIndex })}
                                className="inline-flex items-center gap-1 rounded-xl bg-ink px-3 py-1.5 text-xs font-medium text-paper hover:bg-ink"
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

            {orphanArrivals.length > 0 && (
              <div className="mt-6 overflow-hidden rounded-3xl border-2 border-[#a87b1e]/40 bg-bone">
                <button
                  type="button"
                  onClick={() => setShowOrphans(prev => !prev)}
                  className="flex w-full items-center justify-between px-4 py-3 text-left"
                >
                  <div className="flex items-center gap-2">
                    <FilePlus size={16} className="text-[#a87b1e]" />
                    <h2 className="text-sm font-semibold text-[#a87b1e]">未登録の入荷（発注なしで在庫追加された記録）</h2>
                    <span className="rounded-full bg-white px-2 py-0.5 text-[11px] text-[#a87b1e]">{orphanArrivals.length}件</span>
                  </div>
                  <span className="text-xs text-[#a87b1e]">{showOrphans ? '隠す' : '表示'}</span>
                </button>
                {showOrphans && (
                  <div className="overflow-x-auto border-t border-[#a87b1e]/40 bg-white">
                    <table className="w-full text-sm">
                      <thead className="bg-bone text-left text-xs uppercase tracking-wider text-[#a87b1e]">
                        <tr>
                          <th className="px-4 py-3">入荷日</th>
                          <th className="px-4 py-3">商品</th>
                          <th className="px-4 py-3">数量</th>
                          <th className="px-4 py-3 text-right"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {orphanArrivals.map(({ product, arrival }) => (
                          <tr key={`${product.id}:${arrival.id}`} className="border-t border-[#a87b1e]/40">
                            <td className="px-4 py-3 text-ink">{arrival.arrivalDate || '-'}</td>
                            <td className="px-4 py-3 text-ink">
                              {product.name}
                              {product.sku && <span className="ml-1 text-[11px] text-mist">({product.sku})</span>}
                            </td>
                            <td className="px-4 py-3 text-ink">{formatKg(arrival.quantityKg)}</td>
                            <td className="px-4 py-3 text-right">
                              {isAdmin && (
                                <div className="inline-flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => setOrphanTarget({ product, arrival })}
                                    className="inline-flex items-center gap-1 rounded-xl bg-ink px-3 py-1.5 text-xs font-medium text-paper hover:bg-ink"
                                  >
                                    <FilePlus size={14} />
                                    発注として登録
                                  </button>
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      if (!confirm(`${product.name} の ${arrival.arrivalDate} の入荷記録（${formatKg(arrival.quantityKg)}）を削除しますか？\n在庫から差し引かれます。`)) return
                                      const services = await getServices()
                                      await services.inventory.deleteArrivalRecord(product.id, arrival.id)
                                      await load()
                                    }}
                                    title="入荷記録を削除"
                                    className="inline-flex items-center gap-1 rounded-xl border border-alert/40 px-3 py-1.5 text-xs font-medium text-alert hover:bg-alert/5"
                                  >
                                    <Trash2 size={14} />
                                    削除
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            <div className="mt-6">
              <button
                type="button"
                onClick={() => setShowReceived(prev => !prev)}
                className="text-sm font-medium text-matchaDeep hover:underline"
              >
                入荷済み（{receivedLines.length}件）{showReceived ? 'を隠す' : 'を表示'}
              </button>
              {showReceived && (
                <div className="mt-3 overflow-hidden rounded-3xl border border-[#e6dfcf] bg-white">
                  <table className="w-full text-sm">
                    <thead className="bg-bone text-left text-xs uppercase tracking-wider text-mist">
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
                          <td colSpan={4} className="px-4 py-8 text-center text-mist">入荷済みの商品はありません</td>
                        </tr>
                      ) : (
                        receivedLines.map(({ order, lineIndex }) => {
                          const item = order.items[lineIndex]
                          return (
                            <tr key={`${order.id}:${lineIndex}`} className="border-t border-[#f0ebdf]">
                              <td className="px-4 py-3 text-ink">{order.supplierName}</td>
                              <td className="px-4 py-3 text-ink">{item.productName || '-'}</td>
                              <td className="px-4 py-3 text-ink">{formatKg(item.quantityKg)}</td>
                              <td className="px-4 py-3 text-right">
                                {isAdmin && (
                                  <button
                                    type="button"
                                    onClick={() => handleUnreceive({ order, lineIndex })}
                                    className="inline-flex items-center gap-1 rounded-xl border border-line px-3 py-1.5 text-xs font-medium text-ink hover:bg-bone"
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

      <OrphanConvertModal
        target={orphanTarget}
        onClose={() => setOrphanTarget(null)}
        onConfirm={async input => {
          if (!orphanTarget) return
          const services = await getServices()
          await services.purchaseOrders.convertOrphanArrivalToPo(
            orphanTarget.product.id,
            orphanTarget.arrival.id,
            input,
          )
          setOrphanTarget(null)
          await load()
        }}
      />
    </AppLayout>
  )
}

function OrphanConvertModal({
  target,
  onClose,
  onConfirm,
}: {
  target: OrphanArrival | null
  onClose: () => void
  onConfirm: (input: {
    supplierName: string
    unitPrice: number
    taxRate: 8 | 10
    orderDate: string
    notes?: string
  }) => Promise<void>
}) {
  const [supplierName, setSupplierName] = useState('')
  const [unitPrice, setUnitPrice] = useState(0)
  const [taxRate, setTaxRate] = useState<8 | 10>(8)
  const [orderDate, setOrderDate] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!target) return
    setSupplierName('')
    setUnitPrice(target.product.purchaseUnitPrice ?? 0)
    setTaxRate(8)
    setOrderDate(target.arrival.arrivalDate || todayIso())
    setNotes('')
    setError('')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.product.id, target?.arrival.id])

  if (!target) return null

  const lineTotal = (Number(target.arrival.quantityKg) || 0) * (Number(unitPrice) || 0)
  const tax = computeTax([{ quantityKg: Number(target.arrival.quantityKg) || 0, unitPrice: Number(unitPrice) || 0, taxRate }])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      if (!supplierName.trim()) throw new Error('仕入先を入力してください')
      await onConfirm({ supplierName: supplierName.trim(), unitPrice, taxRate, orderDate, notes })
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/35 p-0 sm:items-center sm:p-4">
      <div className="max-h-[100vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-4 shadow-2xl sm:max-h-[92vh] sm:rounded-3xl sm:p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold text-ink">発注として登録</h2>
            <p className="mt-1 text-xs text-mist">
              {target.product.name}{target.product.sku && `（${target.product.sku}）`} / {formatKg(target.arrival.quantityKg)} / 入荷日 {target.arrival.arrivalDate}
            </p>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-gray-400 hover:bg-bone hover:text-mist">
            <X size={18} />
          </button>
        </div>

        {error && <div className="mb-3 rounded-xl border border-alert/40 bg-alert/5 px-3 py-2 text-sm text-alert">{error}</div>}

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-graphite">仕入先</label>
            <input
              required
              value={supplierName}
              onChange={e => setSupplierName(e.target.value)}
              placeholder="例: 鹿児島茶葉商会（不明な場合は「不明」など）"
              className="w-full rounded-xl border border-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-matcha"
            />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-graphite">税抜単価</label>
              <input
                type="number"
                min="0"
                step="1"
                value={unitPrice}
                onChange={e => setUnitPrice(Number(e.target.value) || 0)}
                className="w-full rounded-xl border border-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-matcha"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-graphite">税率</label>
              <select
                value={taxRate}
                onChange={e => setTaxRate(Number(e.target.value) === 10 ? 10 : 8)}
                className="w-full rounded-xl border border-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-matcha"
              >
                <option value={8}>8%軽減</option>
                <option value={10}>10%</option>
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-graphite">発注日</label>
            <input
              type="date"
              value={orderDate}
              onChange={e => setOrderDate(e.target.value)}
              className="w-full rounded-xl border border-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-matcha"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-graphite">備考（任意）</label>
            <textarea
              rows={2}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="未入力時は「期首在庫から自動変換」"
              className="w-full rounded-xl border border-line px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-matcha"
            />
          </div>

          <div className="rounded-xl bg-bone p-3 text-xs text-mist">
            <div className="flex justify-between"><span>金額（税抜）</span><span className="font-medium text-ink">¥{new Intl.NumberFormat('ja-JP').format(lineTotal)}</span></div>
            <div className="flex justify-between"><span>消費税</span><span>¥{new Intl.NumberFormat('ja-JP').format(tax)}</span></div>
            <div className="mt-1 flex justify-between border-t border-[#e6dfcf] pt-1 font-semibold text-ink"><span>税込合計</span><span>¥{new Intl.NumberFormat('ja-JP').format(lineTotal + tax)}</span></div>
          </div>

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-line px-4 py-2.5 text-sm text-graphite hover:bg-bone">
              キャンセル
            </button>
            <button type="submit" disabled={saving} className="flex-1 rounded-xl bg-ink px-4 py-2.5 text-sm font-medium text-paper hover:bg-ink disabled:opacity-60">
              {saving ? '登録中…' : '発注を作成'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
