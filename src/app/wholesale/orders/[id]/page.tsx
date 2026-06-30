'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { AppLayout } from '@/components/layout/AppLayout'
import { useAuth } from '@/contexts/AuthContext'
import { useConfirm } from '@/contexts/ConfirmContext'
import { getFirebaseAuthInstance } from '@/lib/firebase/config'
import { getServices } from '@/lib/services'
import type { MasterEntry } from '@/types'
import { ArrowLeft, RefreshCw, Plus, Trash2 } from 'lucide-react'

interface OrderItem {
  productId?: string
  productName: string
  quantityKg: number
  sampleUnits?: number
  unitPriceJpy?: number
  lineTotalJpy?: number
  madeToOrder?: boolean
  hsCode?: string
  option?: { optionName?: string; tierLabel?: string; bags?: number; feeJpy?: number }
}
interface Order {
  id: string
  orderNumber: string
  memberCompanyName?: string
  memberEmail?: string
  shippingEmail?: string
  contactName?: string
  phone?: string
  items?: OrderItem[]
  subtotalJpy?: number
  optionFeesJpy?: number
  taxJpy?: number
  totalJpy?: number
  feeLines?: { name: string; quantity?: number; unit?: string; unitPriceJpy?: number; amountJpy: number; taxRate?: number }[]
  paymentMethod?: string
  paymentStatus?: string
  needsRefund?: boolean
  bankDueAtMs?: number
  transferReportedAt?: string
  status?: string
  shippingCountry?: string
  shippingPostalCode?: string
  shippingAddress?: string
  isDomestic?: boolean
  overseasCarrier?: string
  shippingFeeJpy?: number
  shippingWeightKg?: number
  checkoutUrl?: string
  notes?: string
  buyerTaxId?: string
  couponCode?: string
  couponDiscountJpy?: number
  trackingNumber?: string
  shippingCarrierLabel?: string
  shippedAt?: string
  shipmentEmailedAt?: string
  shipRequestedAt?: string
  shipRequestedBy?: string
  proformaInvoiceNo?: string
  receiptAtena?: string
  receiptProviso?: string
  proformaValidUntil?: string
  uploadedDocs?: Partial<Record<'commercial' | 'packingList', { storagePath: string; fileName: string; uploadedAt: string }>>
  // Staff-only accounting (console API only; stripped from the member API).
  costAmountJpy?: number
  grossProfitJpy?: number
  paymentFeeJpy?: number
  adminMemo?: string
  shippingMemo?: string
  stripeFeeJpy?: number
  stripeNetJpy?: number
  dueDate?: string
  paidAtMs?: number
  createdAtMs?: number
  origin?: string
}

interface EditState {
  items: { productId: string; quantityKg: string; unitPriceJpy: string; taxRate: number }[]
  feeLines: { name: string; quantity: string; unitPriceJpy: string; taxRate: number }[]
  shippingCountry: string
  shippingPostalCode: string
  shippingAddress: string
  contactName: string
  phone: string
  shippingEmail: string
  notes: string
  dueDate: string
  shippingFeeJpy: string
  paymentFeeJpy: string
}

async function token(): Promise<string> {
  const current = getFirebaseAuthInstance().currentUser
  if (!current) throw new Error('未ログイン')
  return current.getIdToken()
}

const STATUS_LABEL: Record<string, string> = {
  pending_acceptance: '承諾待ち（見積）',
  pending_approval: '承認待ち',
  pending_quote: '見積待ち',
  quoted: '支払い待ち（見積済）',
  pending_payment: '支払い待ち',
  paid: '支払い済み',
  shipped: '出荷済み',
  cancelled: '取消',
}
const CARRIER_LABEL: Record<string, string> = {
  ems: 'EMS（国際スピード郵便）',
  epacket: '国際エアパケット',
  dhl: 'DHL',
  designated: '御社指定業者',
}

// 自動生成書類のダウンロード用ルート（注文データから都度生成）。
const DOC_ROUTE = { invoice: 'invoice', proforma: 'proforma-invoice', receipt: 'receipt', deliveryNote: 'delivery-note' } as const
type DocKind = keyof typeof DOC_ROUTE
// 手動アップロード書類（越境）。
type UploadKind = 'commercial' | 'packingList'
const UPLOAD_LABEL: Record<UploadKind, string> = { commercial: 'Commercial Invoice', packingList: 'Packing List' }

export default function WholesaleOrderDetailPage() {
  const router = useRouter()
  const { user } = useAuth()
  // 操作の権限: 入金確認系は admin+finance、それ以外(承認/取消/発送/書類/削除/編集)は admin 限定。viewer は閲覧のみ。
  const isAdmin = user?.role === 'admin'
  const canConfirmPayment = isAdmin || user?.role === 'finance'
  const { id } = useParams<{ id: string }>()
  const [order, setOrder] = useState<Order | null>(null)
  const [costByProduct, setCostByProduct] = useState<Record<string, number>>({})
  const [productList, setProductList] = useState<{ id: string; name: string; sku?: string; price: number }[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [uploadingKind, setUploadingKind] = useState<UploadKind | null>(null)
  const [tracking, setTracking] = useState('')
  const [carrierLabel, setCarrierLabel] = useState('')
  const [carriers, setCarriers] = useState<MasterEntry[]>([])
  const [editing, setEditing] = useState(false)
  const [edit, setEdit] = useState<EditState | null>(null)
  const [linkCopied, setLinkCopied] = useState(false)
  const [adminMemo, setAdminMemo] = useState('')
  const [shippingMemo, setShippingMemo] = useState('')
  const { confirm, notify } = useConfirm()

  const copyLink = (url: string) => {
    navigator.clipboard?.writeText(url).then(
      () => { setLinkCopied(true); setTimeout(() => setLinkCopied(false), 1500) },
      () => {},
    )
  }

  const saveMemos = async () => {
    if (!order) return
    setBusy(true)
    try {
      const res = await fetch('/api/wholesale/orders', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({ orderId: order.id, action: 'set_memos', adminMemo, shippingMemo }),
      })
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!res.ok) notify(`保存に失敗しました（${d.error ?? 'error'}）`, 'error')
      else await load()
    } finally {
      setBusy(false)
    }
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [res, services] = await Promise.all([
        fetch('/api/wholesale/orders', { headers: { Authorization: `Bearer ${await token()}` }, cache: 'no-store' }),
        getServices(),
      ])
      const data = (await res.json()) as { orders?: Order[] }
      // Order ids can contain ':' (e.g. migrated:<saleId>), which may arrive
      // percent-encoded in the route param — match against the decoded form too.
      let wanted = id
      try { wanted = decodeURIComponent(id) } catch { /* keep raw */ }
      const found = data.orders?.find(o => o.id === id || o.id === wanted) ?? null
      setOrder(found)
      setTracking(found?.trackingNumber ?? '')
      setCarrierLabel(found?.shippingCarrierLabel ?? '')
      setAdminMemo(found?.adminMemo ?? '')
      setShippingMemo(found?.shippingMemo ?? '')
      // Purchase prices for live cost/gross-profit on orders without a snapshot.
      const [products, masters] = await Promise.all([
        services.inventory.getProductsWithInventory(),
        services.masters.listMasters(),
      ])
      setCarriers(
        masters
          .filter(m => m.type === 'shipping_method' && m.isActive !== false)
          .sort((a, b) => a.sortOrder - b.sortOrder),
      )
      const costMap: Record<string, number> = {}
      for (const p of products) costMap[p.id] = p.purchaseUnitPrice ?? 0
      setCostByProduct(costMap)
      setProductList(products.map(p => ({ id: p.id, name: p.name, sku: p.sku, price: p.standardWholesalePrice ?? 0 })))
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  const act = async (action: 'confirm_payment' | 'cancel' | 'mark_shipped' | 'notify_shipped' | 'set_fulfillment' | 'approve' | 'accept_quote' | 'resend_payment_link' | 'fetch_fee' | 'request_shipment' | 'cancel_shipment_request', extra: Record<string, unknown> = {}) => {
    if (action === 'accept_quote' && !(await confirm({ message: 'お客様が金額を承諾済みとして、この注文を確定しますか？（在庫はすでに引当済み。確定後は支払い案内へ進めます）', confirmLabel: '確定する' }))) return
    // Cancelling a PAID order does NOT auto-refund — warn staff to refund manually.
    const wasPaid = order?.paymentStatus === 'paid' || order?.status === 'paid'
    if (action === 'cancel') {
      if (wasPaid) {
        const note = order?.paymentMethod === 'bank_transfer'
          ? 'この注文は入金済み（銀行振込）です。取消しても自動返金は行われません。返金は手動でお振込ください。'
          : 'この注文はStripeで決済済みです。取消しても自動返金は行われません。Stripeダッシュボードで手動返金が必要です。'
        if (!(await confirm({ title: '注文の取消', message: `${note}\n\n取消して在庫予約を解放しますか？`, confirmLabel: '取消する', danger: true }))) return
      } else if (!(await confirm({ title: '注文の取消', message: 'この注文を取消し、在庫予約を解放しますか？', confirmLabel: '取消する', danger: true }))) {
        return
      }
    }
    if (action === 'approve' && !(await confirm({ message: 'この注文を承認し、お客様へ支払い案内（カード=支払いリンク／振込=振込案内）を送信しますか？', confirmLabel: '承認する' }))) return
    if (action === 'resend_payment_link' && !(await confirm({ message: '新しいStripeカード決済リンクを発行しますか？（メールは送信されません。発行後、画面に表示されるリンクをお客様にお伝えください）', confirmLabel: '発行する' }))) return
    if (action === 'notify_shipped' && order?.shipmentEmailedAt && !(await confirm({ message: '発送通知メールは既に送信済みです。もう一度送信しますか？', confirmLabel: '再送する' }))) return
    setBusy(true)
    try {
      const res = await fetch('/api/wholesale/orders', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${await token()}` },
        // Use the order's real id (the route param may be percent-encoded for ':').
        body: JSON.stringify({ orderId: order?.id ?? id, action, ...extra }),
      })
      if (action === 'notify_shipped') {
        const d = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
        notify(d.ok ? '発送通知メールを送信しました。' : `送信に失敗しました（${d.error ?? 'error'}）`, d.ok ? 'success' : 'error')
      }
      if (action === 'approve') {
        const d = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
        const msg = d.ok
          ? '承認し、お客様へ支払い案内を送信しました。'
          : d.error === 'overseas_shipping_required'
            ? '海外発送の送料を設定してから承認してください（注文を編集して送料を入力）。'
            : `承認に失敗しました（${d.error ?? 'error'}）`
        notify(msg, d.ok ? 'success' : 'error')
      }
      if (action === 'accept_quote') {
        const d = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
        const msg = d.ok
          ? '承諾を反映し、注文を確定しました（支払い待ち）。'
          : d.error === 'quote_expired'
            ? '見積の有効期限が切れています。この見積は自動取消の対象のため確定できません。再度見積を作成してください。'
            : `確定に失敗しました（${d.error ?? 'error'}）`
        notify(msg, d.ok ? 'success' : 'error')
      }
      if (action === 'resend_payment_link') {
        const d = (await res.json().catch(() => ({}))) as { ok?: boolean; checkoutUrl?: string; error?: string }
        const msg = d.ok
          ? '決済リンクを発行しました。注文画面に表示されたリンクをコピーしてお客様にお伝えください。'
          : d.error === 'not_payable'
            ? 'この注文は決済リンクを発行できる状態ではありません（カードの支払い待ちのみ対象）。'
            : d.error === 'insufficient_stock'
              ? '在庫が不足しているため決済リンクを発行できません。'
              : `発行に失敗しました（${d.error ?? 'error'}）`
        notify(msg, d.ok ? 'success' : 'error')
      }
      if (action === 'fetch_fee') {
        const d = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
        if (!d.ok) {
          const msg =
            d.error === 'no_payment_intent'
              ? 'この注文にStripeの決済情報（PaymentIntent）がないため取得できません。'
              : d.error === 'settlement_unavailable'
                ? 'Stripeから手数料情報を取得できませんでした。時間をおいて再度お試しください。'
                : d.error === 'not_card_order'
                  ? 'カード決済の注文ではありません。'
                  : `取得に失敗しました（${d.error ?? 'error'}）`
          notify(msg, 'error')
        }
      }
      // Surface guard rejections (not_paid / settled / etc.) for actions without a bespoke handler.
      if (!res.ok && action !== 'notify_shipped' && action !== 'approve' && action !== 'accept_quote' && action !== 'resend_payment_link' && action !== 'fetch_fee') {
        const d = (await res.json().catch(() => ({}))) as { error?: string }
        notify(`操作に失敗しました（${d.error ?? 'error'}）`, 'error')
      }
      if (action === 'cancel' && res.ok && wasPaid) {
        notify(
          order?.paymentMethod === 'bank_transfer'
            ? '取消しました。入金済みのため、返金（お振込）を手動で対応してください。'
            : '取消しました。Stripeダッシュボードで返金処理を行ってください（自動返金はされていません）。',
          'info',
        )
      }
      await load()
    } finally {
      setBusy(false)
    }
  }

  // Permanently delete a (test) order + its stock holds. Irreversible — double-confirm
  // and require typing the order number so a real order can't be removed by a stray click.
  const deleteOrder = async () => {
    if (!order) return
    if (!(await confirm({ title: '注文を完全に削除', message: `注文「${order.orderNumber}」を完全に削除します。\n\nこの操作は元に戻せません。テスト注文のみ削除してください。\n紐づく在庫引当（ec_sales）も削除し、在庫を解放します。`, confirmLabel: '削除に進む', danger: true }))) return
    // 取り違え防止の最終ゲート: 注文番号の手入力一致を要求（テキスト入力のため prompt を維持）。
    const typed = window.prompt(`確認のため注文番号「${order.orderNumber}」を入力してください`, '')
    if (typed === null) return
    if (typed.trim() !== order.orderNumber) { notify('注文番号が一致しません。削除を中止しました。', 'error'); return }
    setBusy(true)
    try {
      const res = await fetch('/api/wholesale/orders', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({ orderId: order.id, action: 'delete_order' }),
      })
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!res.ok) { notify(`削除に失敗しました（${d.error ?? 'error'}）`, 'error'); return }
      notify('注文を削除しました。', 'success')
      router.push('/wholesale/orders')
    } finally {
      setBusy(false)
    }
  }

  const startEdit = () => {
    if (!order) return
    setEdit({
      items: (order.items ?? []).map(i => ({ productId: i.productId ?? '', quantityKg: String(i.quantityKg ?? ''), unitPriceJpy: String(i.unitPriceJpy ?? ''), taxRate: 8 })),
      feeLines: (order.feeLines ?? []).map(f => ({ name: f.name ?? '', quantity: String(f.quantity ?? 1), unitPriceJpy: String(f.unitPriceJpy ?? f.amountJpy ?? ''), taxRate: f.taxRate ?? 8 })),
      shippingCountry: order.shippingCountry ?? 'JP',
      shippingPostalCode: order.shippingPostalCode ?? '',
      shippingAddress: order.shippingAddress ?? '',
      contactName: order.contactName ?? '',
      phone: order.phone ?? '',
      shippingEmail: order.shippingEmail ?? '',
      notes: order.notes ?? '',
      dueDate: order.dueDate ?? '',
      shippingFeeJpy: order.shippingFeeJpy != null ? String(order.shippingFeeJpy) : '',
      paymentFeeJpy: order.paymentFeeJpy != null ? String(order.paymentFeeJpy) : '',
    })
    setEditing(true)
  }

  const saveEdit = async () => {
    if (!edit || !order) return
    const items = edit.items.filter(i => i.productId).map(i => ({ productId: i.productId, quantityKg: Number(i.quantityKg) || 0, unitPriceJpy: Number(i.unitPriceJpy) || 0, taxRate: i.taxRate }))
    if (items.length === 0) { notify('商品を1つ以上指定してください', 'error'); return }
    // Guard against 原価割れ — warn (but allow) when a unit price is below cost/kg.
    const belowCost = items.filter(i => { const c = costByProduct[i.productId]; return c != null && i.unitPriceJpy < c })
    if (belowCost.length > 0 && !(await confirm({ message: `単価が原価を下回っている商品が ${belowCost.length} 件あります（原価割れ）。このまま保存しますか？`, confirmLabel: 'このまま保存' }))) return
    const feeLines = edit.feeLines
      .filter(f => f.name.trim())
      .map(f => ({ name: f.name.trim(), quantity: Number(f.quantity) || 0, unitPriceJpy: Number(f.unitPriceJpy) || 0, taxRate: f.taxRate }))
    setBusy(true)
    try {
      const res = await fetch('/api/wholesale/orders', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({
          orderId: order.id, action: 'update_direct_order', items, feeLines,
          shippingCountry: edit.shippingCountry, shippingPostalCode: edit.shippingPostalCode, shippingAddress: edit.shippingAddress,
          contactName: edit.contactName, phone: edit.phone, shippingEmail: edit.shippingEmail, notes: edit.notes, dueDate: edit.dueDate,
          shippingFeeJpy: edit.shippingFeeJpy !== '' ? Number(edit.shippingFeeJpy) : undefined,
          paymentFeeJpy: edit.paymentFeeJpy !== '' ? Number(edit.paymentFeeJpy) : undefined,
        }),
      })
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!res.ok) { notify(`保存に失敗しました（${d.error ?? 'error'}）`, 'error'); return }
      setEditing(false); setEdit(null)
      await load()
    } finally { setBusy(false) }
  }
  const setEditItem = (idx: number, patch: Partial<EditState['items'][number]>) =>
    setEdit(e => e ? { ...e, items: e.items.map((it, i) => i === idx ? { ...it, ...patch } : it) } : e)
  const setEditFee = (idx: number, patch: Partial<EditState['feeLines'][number]>) =>
    setEdit(e => e ? { ...e, feeLines: e.feeLines.map((f, i) => i === idx ? { ...f, ...patch } : f) } : e)

  const quote = async (shippingFeeJpy: number, overseasCarrier: string) => {
    setBusy(true)
    try {
      const res = await fetch('/api/wholesale/orders', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${await token()}` },
        body: JSON.stringify({ orderId: id, action: 'quote', shippingFeeJpy, overseasCarrier }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        notify(
          data.error === 'insufficient_stock'
            ? '在庫が不足しているため見積を確定できません。'
            : `見積の確定に失敗しました（${data.error ?? 'error'}）`,
          'error',
        )
        return
      }
      await load()
    } finally {
      setBusy(false)
    }
  }

  // 自動生成書類をダウンロード（注文データから都度生成）。
  const downloadDoc = async (kind: DocKind) => {
    const res = await fetch(`/api/wholesale/orders/${id}/${DOC_ROUTE[kind]}`, {
      headers: { Authorization: `Bearer ${await token()}` },
    })
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string; detail?: string }
      notify(`書類の取得に失敗しました。${d.detail || d.error || ''}`, 'error')
      return
    }
    window.open(URL.createObjectURL(await res.blob()), '_blank')
  }

  // 手動アップロード書類（越境: Commercial Invoice / Packing List）。
  const uploadDoc = async (kind: UploadKind, file: File) => {
    if (file.type && file.type !== 'application/pdf') { notify('PDFファイルを選択してください', 'error'); return }
    setUploadingKind(kind)
    try {
      const form = new FormData()
      form.append('kind', kind)
      form.append('file', file)
      const res = await fetch(`/api/wholesale/orders/${id}/upload-doc`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${await token()}` },
        body: form,
      })
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string; detail?: string }
        notify(`アップロードに失敗しました。${d.detail || d.error || ''}`, 'error')
        return
      }
      await load()
    } finally {
      setUploadingKind(null)
    }
  }

  const downloadUploaded = async (kind: UploadKind) => {
    const res = await fetch(`/api/wholesale/orders/${id}/upload-doc?kind=${kind}`, {
      headers: { Authorization: `Bearer ${await token()}` },
    })
    if (!res.ok) { notify('書類の取得に失敗しました', 'error'); return }
    window.open(URL.createObjectURL(await res.blob()), '_blank')
  }

  const deleteUploaded = async (kind: UploadKind) => {
    if (!(await confirm({ title: '書類を削除', message: 'アップロードした書類を削除します。よろしいですか？', danger: true, confirmLabel: '削除' }))) return
    setUploadingKind(kind)
    try {
      const res = await fetch(`/api/wholesale/orders/${id}/upload-doc?kind=${kind}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${await token()}` },
      })
      if (!res.ok) { notify('削除に失敗しました', 'error'); return }
      await load()
    } finally {
      setUploadingKind(null)
    }
  }

  const o = order

  // Cost / gross profit (staff only). Use the stored snapshot for migrated orders,
  // otherwise compute live from each product's purchase price.
  // Samples are not bought at cost/kg, so they carry no cost in the 原価/粗利 total.
  const itemCost = (i: OrderItem) => (i.sampleUnits ? 0 : (costByProduct[i.productId ?? ''] ?? 0) * (i.quantityKg ?? 0))
  const revenueExTax = o?.subtotalJpy ?? 0
  const totalCost = o?.costAmountJpy ?? (o?.items ?? []).reduce((s, i) => s + itemCost(i), 0)
  const paymentFee = o?.paymentFeeJpy ?? 0
  const grossProfit = o?.grossProfitJpy ?? revenueExTax - totalCost - paymentFee
  const marginRate = revenueExTax > 0 ? (grossProfit / revenueExTax) * 100 : null

  // Document availability:
  // 見積書 — direct orders (amount not yet finalized), not cancelled.
  // 請求書 — once the amount is committed (支払い待ち以降)、取消以外.
  // 領収書/納品書 — once paid/shipped.
  const canQuote = o?.origin === 'direct' && o?.status !== 'cancelled'
  const canInvoice = !!o && !['pending_acceptance', 'pending_approval', 'pending_quote', 'cancelled'].includes(o.status ?? '')
  const canReceiptDelivery = o?.status === 'paid' || o?.status === 'shipped'
  // 越境(輸出)注文は Proforma を発行可（請求書は国内のみ）。
  const isExport = o?.isDomestic === false
  const canProforma = isExport && !!o && !['pending_quote', 'pending_acceptance', 'pending_approval', 'cancelled'].includes(o.status ?? '')

  return (
    <AppLayout>
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center justify-between">
          <Link href="/wholesale/orders" className="flex items-center gap-1 text-sm text-mist hover:text-ink">
            <ArrowLeft size={15} /> 卸売注文一覧へ
          </Link>
          <div className="flex items-center gap-2">
            {isAdmin && (o?.origin === 'direct' || o?.status === 'pending_approval') && !editing && o?.status !== 'cancelled' && o?.status !== 'paid' && o?.status !== 'shipped' && (
              <button onClick={startEdit} className="flex items-center gap-1 rounded-lg border border-line px-3 py-2 text-sm font-bold text-ink hover:bg-bone">内容を編集</button>
            )}
            <button onClick={load} className="flex items-center gap-1 rounded-lg border border-line px-3 py-2 text-sm font-bold text-ink hover:bg-bone">
              <RefreshCw size={15} /> 更新
            </button>
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-mist">読み込み中…</p>
        ) : !o ? (
          <p className="rounded-lg border border-dashed border-line px-4 py-8 text-center text-sm text-mist">注文が見つかりません。</p>
        ) : (
          <div className={`space-y-5 ${busy ? 'opacity-50' : ''}`}>
            {/* Manual-refund warning: payment landed on a cancelled order, or a paid order was cancelled. */}
            {(o.needsRefund || (o.status === 'cancelled' && o.paymentStatus === 'paid')) && (
              <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
                ⚠ <strong>要返金</strong>：取消済みの注文に入金があります（自動返金はされません）。
                {o.paymentMethod === 'bank_transfer' ? '銀行振込の返金を手動でお振込ください。' : 'Stripeダッシュボードで手動返金を行ってください。'}
              </div>
            )}
            {/* Bank-transfer payment deadline (7 days). No auto-cancel — staff release overdue manually. */}
            {o.status === 'pending_payment' && o.paymentMethod === 'bank_transfer' && o.bankDueAtMs ? (() => {
              const overdue = (o.bankDueAtMs as number) < Date.now()
              const due = new Date(o.bankDueAtMs as number).toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' })
              return (
                <div className={`rounded-lg border px-4 py-3 text-sm ${overdue ? 'border-red-300 bg-red-50 text-red-800' : 'border-line bg-bone text-mist'}`}>
                  {overdue ? (
                    <>⚠ <strong>お振込期限超過</strong>（期限 {due}）。入金が無ければ下部の「取消・在庫解放」で手動キャンセルしてください（自動取消は行われません）。</>
                  ) : (
                    <>お振込期限: <strong>{due}</strong>（未入金・銀行振込）</>
                  )}
                  {o.transferReportedAt ? (
                    <div className="mt-1 font-bold text-[#a87b1e]">💴 お客様より振込報告あり（{new Date(o.transferReportedAt).toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}）— 入金をご確認ください。</div>
                  ) : null}
                </div>
              )
            })() : null}
            {/* Header */}
            <div className="panel p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-sm text-ink">{o.orderNumber}</p>
                  {o.createdAtMs ? (
                    <p className="text-xs text-mist">注文日: {new Date(o.createdAtMs).toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</p>
                  ) : null}
                  <p className="mt-1 text-lg font-semibold text-ink">{o.memberCompanyName}</p>
                  {(o.contactName || o.phone) && (
                    <p className="text-sm text-mist">{[o.contactName, o.phone].filter(Boolean).join(' · ')}</p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-2xl font-semibold text-ink">¥{(o.totalJpy ?? 0).toLocaleString()}</p>
                  <span className="mt-1 inline-block rounded border border-line px-2 py-0.5 text-[11px] text-ink">{STATUS_LABEL[o.status ?? ''] ?? o.status}</span>
                </div>
              </div>
            </div>

            {/* Edit panel — 直販 orders only */}
            {editing && edit && (
              <Section title="内容を編集（直販）">
                <div className="space-y-2">
                  {edit.items.map((it, idx) => (
                    <div key={idx} className="flex flex-wrap items-end gap-2">
                      <label className="min-w-[200px] flex-1 text-[11px] text-mist">商品
                        <select className="field-input mt-1" value={it.productId} onChange={e => { const p = productList.find(x => x.id === e.target.value); setEditItem(idx, { productId: e.target.value, unitPriceJpy: it.unitPriceJpy || String(p?.price ?? '') }) }}>
                          <option value="">— 選択 —</option>
                          {productList.map(p => <option key={p.id} value={p.id}>{p.name}{p.sku ? ` (${p.sku})` : ''}</option>)}
                        </select>
                      </label>
                      <label className="w-24 text-[11px] text-mist">数量(kg)<input type="number" min="0" step="0.1" className="field-input mt-1" value={it.quantityKg} onChange={e => setEditItem(idx, { quantityKg: e.target.value })} /></label>
                      <label className="w-32 text-[11px] text-mist">単価(¥/kg)<input type="number" min="0" step="1" className="field-input mt-1" value={it.unitPriceJpy} onChange={e => setEditItem(idx, { unitPriceJpy: e.target.value })} /></label>
                      {it.productId && costByProduct[it.productId] != null && (
                        <div className="mb-2 text-[11px] leading-tight">
                          <span className="text-mist">原価<br />¥{Math.round(costByProduct[it.productId]).toLocaleString()}/kg</span>
                          {it.unitPriceJpy !== '' && Number(it.unitPriceJpy) < costByProduct[it.productId] && (
                            <span className="block font-bold text-alert">⚠ 原価割れ</span>
                          )}
                        </div>
                      )}
                      <div className="w-24 text-[11px] text-mist">税率
                        <div className="field-input mt-1 cursor-not-allowed bg-bone text-mist" title="商品の税率は仕向地で自動決定されます（国内 8% 軽減税率 / 輸出 免税）">
                          {(() => { const c = (edit.shippingCountry ?? '').trim().toLowerCase(); const domestic = c === '' || c === '日本' || c === 'japan' || c === 'jp'; return domestic ? '8%（軽減）' : '免税' })()}
                        </div>
                      </div>
                      <button onClick={() => setEdit(e => e ? { ...e, items: e.items.filter((_, i) => i !== idx) } : e)} className="mb-1 p-2 text-mist hover:text-alert" aria-label="削除"><Trash2 size={16} /></button>
                    </div>
                  ))}
                  <button onClick={() => setEdit(e => e ? { ...e, items: [...e.items, { productId: '', quantityKg: '', unitPriceJpy: '', taxRate: 8 }] } : e)} className="flex items-center gap-1 text-sm text-matchaDeep hover:underline"><Plus size={14} /> 商品行を追加</button>
                </div>

                <div className="mt-5 space-y-2 border-t border-line pt-4">
                  <p className="text-xs font-medium text-graphite">オプション・諸費用</p>
                  {edit.feeLines.map((f, idx) => (
                    <div key={idx} className="flex flex-wrap items-end gap-2">
                      <label className="min-w-[180px] flex-1 text-[11px] text-mist">項目名
                        <input className="field-input mt-1" value={f.name} onChange={e => setEditFee(idx, { name: e.target.value })} placeholder="例: 小分け加工費 / 通関手数料" />
                      </label>
                      <label className="w-20 text-[11px] text-mist">数量<input type="number" min="0" step="1" className="field-input mt-1" value={f.quantity} onChange={e => setEditFee(idx, { quantity: e.target.value })} /></label>
                      <label className="w-32 text-[11px] text-mist">単価(¥)<input type="number" min="0" step="1" className="field-input mt-1" value={f.unitPriceJpy} onChange={e => setEditFee(idx, { unitPriceJpy: e.target.value })} /></label>
                      <label className="w-24 text-[11px] text-mist">税率
                        <select className="field-input mt-1" value={f.taxRate} onChange={e => setEditFee(idx, { taxRate: Number(e.target.value) })}>
                          <option value={8}>8%</option>
                          <option value={10}>10%</option>
                          <option value={0}>免税</option>
                        </select>
                      </label>
                      <span className="mb-2 w-24 text-right text-xs text-mist">¥{((Number(f.quantity) || 0) * (Number(f.unitPriceJpy) || 0)).toLocaleString()}</span>
                      <button onClick={() => setEdit(e => e ? { ...e, feeLines: e.feeLines.filter((_, i) => i !== idx) } : e)} className="mb-1 p-2 text-mist hover:text-alert" aria-label="削除"><Trash2 size={16} /></button>
                    </div>
                  ))}
                  <button onClick={() => setEdit(e => e ? { ...e, feeLines: [...e.feeLines, { name: '', quantity: '1', unitPriceJpy: '', taxRate: 8 }] } : e)} className="flex items-center gap-1 text-sm text-matchaDeep hover:underline"><Plus size={14} /> オプションを追加</button>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="text-[11px] text-mist">国（JP=国内）<input className="field-input mt-1" value={edit.shippingCountry} onChange={e => setEdit({ ...edit, shippingCountry: e.target.value })} /></label>
                  <label className="text-[11px] text-mist">郵便番号<input className="field-input mt-1" value={edit.shippingPostalCode} onChange={e => setEdit({ ...edit, shippingPostalCode: e.target.value })} /></label>
                  <label className="text-[11px] text-mist sm:col-span-2">住所<input className="field-input mt-1" value={edit.shippingAddress} onChange={e => setEdit({ ...edit, shippingAddress: e.target.value })} /></label>
                  <label className="text-[11px] text-mist">お届け先名<input className="field-input mt-1" value={edit.contactName} onChange={e => setEdit({ ...edit, contactName: e.target.value })} /></label>
                  <label className="text-[11px] text-mist">電話<input className="field-input mt-1" value={edit.phone} onChange={e => setEdit({ ...edit, phone: e.target.value })} /></label>
                  <label className="text-[11px] text-mist sm:col-span-2">メールアドレス<input type="email" className="field-input mt-1" value={edit.shippingEmail} onChange={e => setEdit({ ...edit, shippingEmail: e.target.value })} /></label>
                  <label className="text-[11px] text-mist">送料(¥税抜)<input type="number" min="0" step="1" className="field-input mt-1" value={edit.shippingFeeJpy} onChange={e => setEdit({ ...edit, shippingFeeJpy: e.target.value })} /></label>
                  <label className="text-[11px] text-mist">支払手数料(¥)<input type="number" min="0" step="1" className="field-input mt-1" value={edit.paymentFeeJpy} onChange={e => setEdit({ ...edit, paymentFeeJpy: e.target.value })} /></label>
                  <label className="text-[11px] text-mist">支払期日<input type="date" className="field-input mt-1" value={edit.dueDate} onChange={e => setEdit({ ...edit, dueDate: e.target.value })} /></label>
                  <label className="text-[11px] text-mist sm:col-span-2">備考<input className="field-input mt-1" value={edit.notes} onChange={e => setEdit({ ...edit, notes: e.target.value })} /></label>
                </div>
                <div className="mt-4 flex gap-2">
                  <button onClick={saveEdit} disabled={busy} className="btn-primary">保存</button>
                  <button onClick={() => { setEditing(false); setEdit(null) }} disabled={busy} className="btn-ghost">キャンセル</button>
                </div>
                <p className="mt-2 text-[11px] text-mist">※保存すると金額・消費税・原価・粗利を再計算し、在庫予約も更新します。</p>
              </Section>
            )}

            {/* Items */}
            <Section title="商品">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-mist">
                    <th className="py-2 font-medium">商品名</th>
                    <th className="py-2 text-right font-medium">購入数量</th>
                    <th className="py-2 text-right font-medium">単価</th>
                    <th className="py-2 text-right font-medium">原価/kg</th>
                    <th className="py-2 text-right font-medium">金額（税抜）</th>
                  </tr>
                </thead>
                <tbody>
                  {(o.items ?? []).map((i, idx) => (
                    <tr key={idx} className="border-b border-line last:border-0">
                      <td className="py-2 text-ink">
                        {i.productName}
                        {i.option ? <span className="text-mist"> ／ {i.option.optionName}: {i.option.tierLabel} ×{i.option.bags}</span> : null}
                        {i.madeToOrder ? <span className="ml-2 rounded-full bg-[#ece8ff] px-2 py-0.5 text-[10px] text-graphite">受注生産（在庫引当なし）</span> : null}
                      </td>
                      <td className="whitespace-nowrap py-2 text-right text-mist">{i.sampleUnits ? `サンプル ${i.sampleUnits}×10g` : `${i.quantityKg}kg`}</td>
                      <td className="whitespace-nowrap py-2 text-right text-mist">{i.unitPriceJpy != null ? `¥${i.unitPriceJpy.toLocaleString()}` : '—'}</td>
                      <td className="whitespace-nowrap py-2 text-right">
                        {(() => {
                          // Samples are priced from the wholesale rate, not bought at cost/kg —
                          // showing cost / a below-cost alert here is misleading, so skip it.
                          if (i.sampleUnits) return <span className="text-mist">—</span>
                          const cost = costByProduct[i.productId ?? '']
                          if (cost == null) return <span className="text-mist">—</span>
                          const below = i.unitPriceJpy != null && i.unitPriceJpy < cost
                          return <span className={below ? 'font-medium text-alert' : 'text-mist'}>¥{Math.round(cost).toLocaleString()}{below ? '（原価割れ）' : ''}</span>
                        })()}
                      </td>
                      <td className="whitespace-nowrap py-2 text-right text-ink">¥{((i.lineTotalJpy ?? 0) + (i.option?.feeJpy ?? 0)).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <dl className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
                <Row label="小計（税抜）" value={`¥${(o.subtotalJpy ?? 0).toLocaleString()}`} />
                {typeof o.couponDiscountJpy === 'number' && o.couponDiscountJpy > 0 && (
                  <Row label={`クーポン割引${o.couponCode ? `（${o.couponCode}）` : ''}`} value={`-¥${o.couponDiscountJpy.toLocaleString()}`} />
                )}
                {typeof o.shippingFeeJpy === 'number' && o.shippingFeeJpy > 0 && <Row label="送料" value={`¥${o.shippingFeeJpy.toLocaleString()}`} />}
                {o.feeLines && o.feeLines.length > 0
                  ? o.feeLines.map((f, i) => (
                      <Row
                        key={i}
                        label={`諸費用: ${f.name}${f.quantity ? ` ×${f.quantity}${f.unit ?? ''}` : ''}${f.taxRate != null ? `（${f.taxRate === 0 ? '免税' : `${f.taxRate}%`}）` : ''}`}
                        value={`¥${f.amountJpy.toLocaleString()}`}
                      />
                    ))
                  : typeof o.optionFeesJpy === 'number' && o.optionFeesJpy > 0 && <Row label="オプション料" value={`¥${o.optionFeesJpy.toLocaleString()}`} />}
                <Row label="消費税" value={`¥${(o.taxJpy ?? 0).toLocaleString()}`} />
                <Row label="合計（税込）" value={`¥${(o.totalJpy ?? 0).toLocaleString()}`} strong />
              </dl>
            </Section>

            {/* Finance — staff only */}
            <Section title="財務">
              <dl className="space-y-1 text-sm">
                <Row label="売上（税抜）" value={`¥${revenueExTax.toLocaleString()}`} />
                <Row label="税込み売上" value={`¥${(o.totalJpy ?? 0).toLocaleString()}`} />
                <Row label="原価" value={`¥${Math.round(totalCost).toLocaleString()}`} />
                {paymentFee > 0 && <Row label="支払手数料" value={`¥${paymentFee.toLocaleString()}`} />}
                <Row label="粗利" value={`¥${Math.round(grossProfit).toLocaleString()}${marginRate != null ? `（${marginRate.toFixed(1)}%）` : ''}`} strong />
                {/* Stripe settlement — fee charged + net actually deposited (card only).
                    Shown for paid card orders; if not yet captured, offer a fetch button. */}
                {o.paymentMethod === 'stripe' && (o.paymentStatus === 'paid' || o.status === 'paid') && (
                  typeof o.stripeFeeJpy === 'number' ? (
                    <>
                      <Row label="Stripe手数料" value={`¥${o.stripeFeeJpy.toLocaleString()}`} />
                      <Row label="入金額（手数料差引後）" value={`¥${(o.stripeNetJpy ?? (o.totalJpy ?? 0) - o.stripeFeeJpy).toLocaleString()}`} strong />
                    </>
                  ) : (
                    <div className="flex items-center justify-between">
                      <dt className="text-mist">Stripe手数料</dt>
                      <dd>
                        <button onClick={() => act('fetch_fee')} disabled={busy} className="text-xs text-matchaDeep underline disabled:opacity-50">未取得 — Stripeから取得</button>
                      </dd>
                    </div>
                  )
                )}
              </dl>
              <p className="mt-2 text-[11px] text-mist">{o.costAmountJpy != null ? '※移行時の原価スナップショット' : '※現在の仕入単価から自動計算'}</p>
            </Section>

            {/* Shipping & payment */}
            <Section title="発送・支払い">
              <dl className="space-y-1 text-sm">
                <Row label="区分" value={o.isDomestic === false ? '海外' : '国内'} />
                <Row label="発送方法" value={o.isDomestic === false ? (o.overseasCarrier ? CARRIER_LABEL[o.overseasCarrier] ?? o.overseasCarrier : '未定') : '国内配送（重量別）'} />
                {typeof o.shippingWeightKg === 'number' && <Row label="重量" value={`${o.shippingWeightKg.toFixed(2)} kg`} />}
                <Row label="支払い方法" value={o.paymentMethod === 'bank_transfer' ? '銀行振込' : o.paymentMethod === 'stripe' ? 'カード' : '—'} />
                <Row
                  label="支払い状況"
                  value={
                    o.status === 'cancelled' ? '取消'
                      : o.status === 'pending_approval' ? '承認待ち'
                      : o.status === 'pending_quote' ? '見積待ち'
                      : o.status === 'quoted' ? '支払い待ち（見積済）'
                      : (o.paymentStatus === 'paid' || o.status === 'paid') ? '支払い済み'
                      : '支払い待ち'
                  }
                />
                <Row label="発送状況" value={o.status === 'cancelled' ? '—' : (o.status === 'shipped' || o.shippedAt) ? '出荷済み' : '未発送'} />
                {o.dueDate && <Row label="支払期日" value={o.dueDate} />}
                {o.paidAtMs && <Row label="入金日" value={new Date(o.paidAtMs).toLocaleDateString('ja-JP')} />}
              </dl>
            </Section>

            {/* Delivery address — one field per line for legibility */}
            <Section title="お届け先">
              {[o.shippingAddress, o.shippingPostalCode, o.shippingCountry, o.contactName, o.phone, o.memberEmail].some(Boolean) ? (
                <dl className="space-y-1 text-sm">
                  <Field label="住所" value={[o.shippingAddress, o.shippingCountry].filter(Boolean).join(' / ')} />
                  <Field label="名前" value={o.contactName} />
                  <Field label="郵便番号" value={o.shippingPostalCode} />
                  <Field label="電話番号" value={o.phone} />
                  <Field label="メールアドレス" value={o.shippingEmail || o.memberEmail} />
                </dl>
              ) : (
                <p className="text-sm text-mist">—</p>
              )}
              {o.buyerTaxId && <p className="mt-1 text-xs text-mist">税番号: {o.buyerTaxId}</p>}
              {o.notes && <p className="mt-2 text-sm text-mist">備考: {o.notes}</p>}
            </Section>

            {/* Staff-only memos (never shown to the customer). Shipping memo appears on 発送管理. */}
            <Section title="メモ（社内用）">
              <div className="space-y-3">
                <label className="block">
                  <span className="text-xs text-mist">注文メモ</span>
                  <textarea
                    value={adminMemo}
                    onChange={e => setAdminMemo(e.target.value)}
                    rows={2}
                    className="field-input mt-1 w-full"
                    placeholder="この注文に関する社内メモ"
                  />
                </label>
                <label className="block">
                  <span className="text-xs text-mist">発送用メモ（発送管理に表示）</span>
                  <textarea
                    value={shippingMemo}
                    onChange={e => setShippingMemo(e.target.value)}
                    rows={2}
                    className="field-input mt-1 w-full"
                    placeholder="梱包・発送時の注意など"
                  />
                </label>
                <button
                  onClick={saveMemos}
                  disabled={busy || (adminMemo === (o.adminMemo ?? '') && shippingMemo === (o.shippingMemo ?? ''))}
                  className="btn-primary disabled:opacity-50"
                >メモを保存</button>
              </div>
            </Section>

            {/* Quote (overseas, not yet quoted) */}
            {o.status === 'pending_quote' && (
              <Section title="送料見積・リンク発行">
                <QuoteForm defaultCarrier={o.overseasCarrier ?? 'ems'} disabled={busy} onSubmit={quote} />
              </Section>
            )}
            {o.status === 'quoted' && o.paymentMethod !== 'bank_transfer' && o.checkoutUrl && (
              <p className="rounded-lg border border-line bg-bone px-4 py-3 text-xs text-mist">
                支払いリンク発行済み（メール送付済み）:{' '}
                <a href={o.checkoutUrl} target="_blank" rel="noreferrer" className="text-matchaDeep underline">リンクを開く</a>
              </p>
            )}
            {o.status === 'quoted' && o.paymentMethod === 'bank_transfer' && (
              <p className="rounded-lg border border-line bg-bone px-4 py-3 text-xs text-mist">銀行振込のご案内をメール送付済み。入金後に「入金確認」を押してください。</p>
            )}
            {/* Manually-issued card payment link — staff copy it and share with the customer. */}
            {o.status === 'pending_payment' && o.paymentMethod !== 'bank_transfer' && o.paymentStatus !== 'paid' && o.checkoutUrl && (
              <Section title="決済リンク">
                <p className="mb-2 text-xs text-mist">発行済みのカード決済リンクです。コピーしてお客様にお伝えください（リンクは約30分間有効です。期限切れの場合は「決済リンクを再発行」してください）。</p>
                <div className="flex flex-wrap items-center gap-2">
                  <input readOnly value={o.checkoutUrl} onFocus={e => e.currentTarget.select()} className="field-input min-w-0 flex-1 text-xs" />
                  <button onClick={() => copyLink(o.checkoutUrl!)} className="rounded-lg border border-line px-3 py-2 text-sm font-bold text-ink hover:bg-bone">{linkCopied ? 'コピーしました' : 'コピー'}</button>
                  <a href={o.checkoutUrl} target="_blank" rel="noreferrer" className="rounded-lg border border-line px-3 py-2 text-sm text-matchaDeep hover:bg-bone">開く</a>
                </div>
              </Section>
            )}

            {/* Fulfillment — carrier/tracking + shipping status. Direct (staff-entered)
                orders can edit the 発送 info at any (non-cancelled) status. */}
            {isAdmin && (o.status === 'paid' || o.status === 'shipped' || o.status === 'pending_payment' || (o.origin === 'direct' && o.status !== 'cancelled')) && (
              <Section title="出荷・発送通知">
                {/* 発送指示: 入金前でも出荷したい掛け取引向け。発送管理に「要発送」として表示。 */}
                {o.status !== 'shipped' && o.status !== 'cancelled' && (
                  <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-[#cfe0d3] bg-[#f3f7f1] px-3 py-2">
                    {o.shipRequestedAt ? (
                      <>
                        <span className="text-xs text-matchaDeep">発送指示済み: {o.shipRequestedAt.slice(0, 16).replace('T', ' ')}{o.shipRequestedBy ? `（${o.shipRequestedBy}）` : ''}</span>
                        <button onClick={() => act('cancel_shipment_request')} disabled={busy} className="btn-ghost text-xs">発送指示を取消</button>
                      </>
                    ) : (
                      <>
                        <span className="text-xs text-mist">入金前でも発送する場合は、発送指示を出すと発送管理に「要発送」として表示されます。</span>
                        <button onClick={() => act('request_shipment')} disabled={busy} className="btn-primary">発送指示</button>
                      </>
                    )}
                  </div>
                )}
                <div className="mb-3 flex flex-wrap items-end gap-2">
                  <label className="text-xs text-mist">発送業者
                    <select className="mt-1 block w-44 rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-ink outline-none focus:border-ink" value={carrierLabel} onChange={e => setCarrierLabel(e.target.value)}>
                      <option value="">— 選択 —</option>
                      {carriers.map(c => <option key={c.id} value={c.englishName}>{c.japaneseName || c.englishName}</option>)}
                      {carrierLabel && !carriers.some(c => c.englishName === carrierLabel) && <option value={carrierLabel}>{carrierLabel}（旧値）</option>}
                    </select>
                  </label>
                  <label className="text-xs text-mist">追跡番号<input className="mt-1 block w-52 rounded-lg border border-line bg-paper px-2 py-1.5 text-sm text-ink outline-none focus:border-ink" value={tracking} onChange={e => setTracking(e.target.value)} /></label>
                  {(() => {
                    const shipFields = { trackingNumber: tracking, shippingCarrierLabel: carrierLabel }
                    return o.status === 'shipped' ? (
                      <>
                        <button onClick={() => act('set_fulfillment', shipFields)} disabled={busy} className="btn-primary">出荷情報を更新</button>
                        <button onClick={() => act('set_fulfillment', { shipped: false })} disabled={busy} className="btn-ghost">未出荷に戻す</button>
                      </>
                    ) : (o.status === 'paid' || o.shipRequestedAt) ? (
                      <button onClick={() => act('mark_shipped', shipFields)} disabled={busy} className="btn-primary">出荷済みにする</button>
                    ) : (
                      // Not yet paid and no 発送指示 — save carrier/tracking without changing status.
                      <button onClick={() => act('set_fulfillment', shipFields)} disabled={busy} className="btn-primary">発送情報を保存</button>
                    )
                  })()}
                </div>
                {o.shippedAt && <p className="mb-2 text-xs text-mist">出荷日: {o.shippedAt.slice(0, 10)}</p>}

                {/* 越境: 外部(DHL/EMS)で作成した通関書類をアップロード。発送通知メールに自動添付される。 */}
                {isExport && (
                  <div className="mb-3 rounded-lg border border-line bg-bone/50 p-3">
                    <p className="mb-1 text-xs font-mono uppercase tracking-brand text-mist">通関書類のアップロード（越境）</p>
                    <p className="mb-3 text-xs text-mist">DHL / EMS で作成した PDF をアップロードすると、発送通知メールに自動添付され、お客様のマイページからもDLできます。</p>
                    <div className="space-y-2">
                      {(['commercial', 'packingList'] as UploadKind[]).map(kind => {
                        const doc = o.uploadedDocs?.[kind]
                        const isBusy = uploadingKind === kind
                        return (
                          <div key={kind} className="flex flex-wrap items-center gap-3 border-b border-line/40 pb-2">
                            <span className="w-40 text-sm text-ink">{UPLOAD_LABEL[kind]}{kind === 'packingList' && <span className="text-xs text-mist">（任意）</span>}</span>
                            {doc ? (
                              <>
                                <button onClick={() => downloadUploaded(kind)} className="text-sm text-matchaDeep underline hover:opacity-80">{doc.fileName}</button>
                                <span className="text-xs text-mist">{doc.uploadedAt.slice(0, 16).replace('T', ' ')}</span>
                                <label className="cursor-pointer text-xs text-graphite underline">
                                  差し替え
                                  <input type="file" accept="application/pdf" className="hidden" disabled={isBusy} onChange={e => { const f = e.target.files?.[0]; if (f) void uploadDoc(kind, f); e.target.value = '' }} />
                                </label>
                                <button onClick={() => deleteUploaded(kind)} disabled={isBusy} className="text-xs text-red-700 underline">削除</button>
                              </>
                            ) : (
                              <label className="cursor-pointer btn-ghost text-sm">
                                {isBusy ? 'アップロード中…' : 'ファイルを選択'}
                                <input type="file" accept="application/pdf" className="hidden" disabled={isBusy} onChange={e => { const f = e.target.files?.[0]; if (f) void uploadDoc(kind, f); e.target.value = '' }} />
                              </label>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {(o.status === 'paid' || o.status === 'shipped') && (
                  <div className="flex flex-wrap items-center gap-3">
                    <button onClick={() => act('notify_shipped')} disabled={busy} className="btn-ghost">発送通知メールを送信</button>
                    {o.shipmentEmailedAt && <span className="text-xs text-mist">最終送信: {o.shipmentEmailedAt.slice(0, 16).replace('T', ' ')}</span>}
                  </div>
                )}
              </Section>
            )}

            {/* Actions */}
            <div className="flex flex-wrap gap-2">
              {isAdmin && o.status === 'pending_acceptance' && !editing && (
                <button onClick={() => act('accept_quote')} disabled={busy} className="btn-primary">承諾して確定</button>
              )}
              {isAdmin && o.status === 'pending_approval' && !editing && (
                <button onClick={() => act('approve')} disabled={busy} className="btn-primary">承認して支払い案内を送る</button>
              )}
              {canConfirmPayment && (o.status === 'pending_payment' || o.status === 'quoted') && o.paymentMethod === 'bank_transfer' && (
                <button onClick={() => act('confirm_payment')} disabled={busy} className="btn-primary">入金確認</button>
              )}
              {/* Card fallback: if a Stripe webhook is missed and the order stays unpaid,
                  staff can confirm manually AFTER verifying payment in the Stripe dashboard. */}
              {isAdmin && (o.status === 'pending_payment' || o.status === 'quoted') && o.paymentMethod !== 'bank_transfer' && o.paymentStatus !== 'paid' && (
                <button onClick={() => act('resend_payment_link')} disabled={busy} className="btn-primary">{o.checkoutUrl ? '決済リンクを再発行' : '決済リンクを発行'}</button>
              )}
              {canConfirmPayment && (o.status === 'pending_payment' || o.status === 'quoted') && o.paymentMethod !== 'bank_transfer' && (
                <button
                  onClick={async () => { if (await confirm({ title: '入金の手動確定', message: 'Stripeダッシュボードで入金を確認しましたか？\n\nこれはWebhook未達などで未反映の場合の手動確定です。実際に入金されていない注文は確定しないでください。', confirmLabel: '確定する' })) act('confirm_payment') }}
                  disabled={busy}
                  className="btn-ghost"
                >入金を手動確認（カード）</button>
              )}
              {isAdmin && canInvoice && !isExport && (
                <button onClick={() => downloadDoc('invoice')} disabled={busy} className="btn-ghost">請求書</button>
              )}
              {isAdmin && canProforma && (
                <button onClick={() => downloadDoc('proforma')} disabled={busy} className="btn-ghost">Proforma Invoice</button>
              )}
              {isAdmin && canReceiptDelivery && (
                <button onClick={() => downloadDoc('receipt')} disabled={busy} className="btn-ghost">領収書</button>
              )}
              {isAdmin && canReceiptDelivery && !isExport && (
                <button onClick={() => downloadDoc('deliveryNote')} disabled={busy} className="btn-ghost">納品書兼領収書</button>
              )}
              {isAdmin && o.status !== 'cancelled' && o.status !== 'shipped' && (
                <button onClick={() => act('cancel')} disabled={busy} className="btn-danger">取消・在庫解放</button>
              )}
            </div>

            {/* Danger zone: permanent delete (test-data cleanup) — admin only */}
            {isAdmin && (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50/50 px-4 py-3">
                <p className="text-xs text-red-800">テスト注文の削除：注文と在庫引当を完全に削除します（元に戻せません）。</p>
                <button onClick={deleteOrder} disabled={busy} className="rounded-lg border border-red-400 bg-white px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-100">注文を削除</button>
              </div>
            )}
          </div>
        )}
      </div>
    </AppLayout>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="panel p-5">
      <h2 className="mb-bl-2 text-xs font-medium text-graphite">{title}</h2>
      {children}
    </div>
  )
}

function Field({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 text-mist">{label}</dt>
      <dd className="text-ink">{value || '—'}</dd>
    </div>
  )
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between">
      <dt className="text-mist">{label}</dt>
      <dd className={strong ? 'font-semibold text-ink' : 'text-ink'}>{value}</dd>
    </div>
  )
}

function QuoteForm({
  defaultCarrier,
  disabled,
  onSubmit,
}: {
  defaultCarrier: string
  disabled: boolean
  onSubmit: (feeJpy: number, carrier: string) => void
}) {
  const [fee, setFee] = useState('')
  const [carrier, setCarrier] = useState(defaultCarrier)
  const valid = fee !== '' && Number(fee) >= 0

  return (
    <div className="rounded-lg border border-line bg-bone p-3">
      <p className="mb-2 text-xs font-medium text-ink">送料を確定して支払いリンクを発行（在庫を7日間ホールド）</p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-mist">
          発送業者
          <select value={carrier} onChange={e => setCarrier(e.target.value)} className="field-input mt-1 block">
            <option value="ems">EMS（国際スピード郵便）</option>
            <option value="epacket">国際エアパケット</option>
            <option value="dhl">DHL</option>
            <option value="designated">御社指定業者</option>
          </select>
        </label>
        <label className="text-xs text-mist">
          送料 (円・税抜/免税)
          <input type="number" min="0" step="1" value={fee} onChange={e => setFee(e.target.value)} className="mt-1 block w-32 border border-line bg-paper px-2 py-1.5 text-sm text-ink outline-none focus:border-ink" placeholder="例: 4500" />
        </label>
        <button type="button" disabled={disabled || !valid} onClick={() => onSubmit(Number(fee), carrier)} className="btn-primary">
          送料確定・リンク発行
        </button>
      </div>
    </div>
  )
}
