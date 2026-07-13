// ─────────────────────────────────────────────────────────────────────────────
// orderView — the single source of truth for how a wholesale order's state is
// PRESENTED and which action a staffer should take next.
//
// The stored backend model is intentionally left unchanged: an order still has an
// 8-value `status`, an orthogonal `paymentStatus`, and dimension flags (origin,
// isDomestic, madeToOrder, item kind). Historically every screen re-derived its own
// labels from these (list `paymentStateLabel`/`shippingStateLabel`, detail
// `STATUS_LABEL`, shipping `ActionState`, `StatusBadge`), so the SAME order read
// differently on each screen. `deriveOrderView` collapses all of that into one
// projection:
//
//   • ONE linear phase (見積・確認 → お支払い待ち → 準備・発送 → 発送済み → 完了 / 取消)
//   • TWO independent tracks — payment and fulfillment — because 掛け取引 lets an
//     order ship while still unpaid, so payment-state and shipping-state genuinely
//     diverge and must NOT be squeezed into one enum.
//   • Immutable order-type flags (kind) that decide which documents/steps apply.
//   • nextActions: the 1–2 operations actually valid right now (the "次にやること"
//     engine that lets a non-expert operate the screen safely).
//
// This module does NOT talk to the network and has no side effects — it is a pure
// function so it can be unit-tested and reused by both apps. It is deliberately
// separate from `wholesaleAdapter.orderToSale` (which projects orders into the
// accounting `SaleRecord` shape); that contract is unchanged.
//
// SYNC CONTRACT: a byte-for-byte copy of this file lives in sabo-wholesale
// (src/lib/orderView.ts). Keep the two in sync when editing, the same way the two
// emailTemplates.ts copies are kept in sync.
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal structural shape `deriveOrderView` reads. Both the console `Order` and
 *  the wholesale `WholesaleOrder` satisfy this. */
export interface OrderViewInput {
  status?: string
  paymentStatus?: string
  paymentMethod?: string
  isDomestic?: boolean
  overseasCarrier?: string
  origin?: string
  items?: { kind?: string; madeToOrder?: boolean }[]
  shippedAt?: string
  shipRequestedAt?: string
  shipmentEmailedAt?: string
  transferReportedAt?: string
  needsRefund?: boolean
  checkoutUrl?: string
  bankDueAtMs?: number
  acceptanceExpiresAtMs?: number
  createdAtMs?: number
}

// ── Model ────────────────────────────────────────────────────────────────────

/** The single linear lifecycle phase shown identically on every screen. */
export type OrderPhase =
  | 'estimate' // 見積・確認 — 金額未確定 or 承認前（理由サブ状態を併記）
  | 'awaiting_payment' // お支払い待ち — 金額確定・入金待ち
  | 'fulfilling' // 準備・発送 — 入金済み or 発送指示済で発送待ち
  | 'shipped' // 発送済み
  | 'done' // 完了（発送通知済み）
  | 'cancelled' // 取消

/** Why an `estimate`-phase order is waiting, i.e. whose action unblocks it. */
export type PhaseReason =
  | 'quote_shipping' // 海外送料の見積待ち（管理者：送料見積）← pending_quote
  | 'production_approval' // 受注生産の承認待ち（管理者：承認）← pending_approval
  | 'customer_acceptance' // お客様の承諾待ち（直販見積）← pending_acceptance

/** Payment track — independent from phase (掛け取引 can ship while unpaid). */
export type PaymentTrack = 'unpaid' | 'reported' | 'paid' | 'invoiced' | 'uninvoiced' | 'refund_required'

/** Fulfillment track — independent from phase. */
export type FulfillmentTrack = 'not_ready' | 'ready_to_ship' | 'shipped' | 'notified'

/** Immutable order-type flags (set at creation) that drive documents/steps. */
export interface OrderKind {
  channel: 'ec' | 'direct'
  destination: 'domestic' | 'overseas'
  production: 'stock' | 'made_to_order'
  hasSample: boolean
}

export type OrderAlert = 'refund_required' | 'overdue' | 'transfer_reported'

/** A single valid next action. `id` matches an existing PATCH action (or a nav
 *  intent) so the UI wires it to the unchanged backend. `roles` lists who may run
 *  it — finance is limited to payment actions, everything else is admin-only. */
export interface NextAction {
  id:
    | 'quote'
    | 'approve'
    | 'accept_quote'
    | 'confirm_payment'
    | 'resend_payment_link'
    | 'mark_shipped'
    | 'notify_shipped'
  label: string
  roles: ('admin' | 'finance')[]
  danger?: boolean
}

export interface OrderView {
  phase: OrderPhase
  phaseReason?: PhaseReason
  phaseLabel: string
  phaseReasonLabel?: string
  phaseTone: string
  payment: PaymentTrack
  paymentLabel: string
  paymentTone: string
  fulfillment: FulfillmentTrack
  fulfillmentLabel: string
  fulfillmentTone: string
  kind: OrderKind
  alerts: OrderAlert[]
  nextActions: NextAction[]
  /** True when payment/fulfillment chips should be suppressed (cancelled orders). */
  closed: boolean
}

// ── Tone tokens (match the existing Tailwind palette used across the screens) ──
const TONE = {
  wait: 'border-[#a87b1e] text-[#a87b1e]', // amber — awaiting staff/customer action
  good: 'border-matcha text-matcha', // green — paid / done
  ship: 'border-ink text-ink', // ink — shipped
  muted: 'border-line text-mist', // grey — neutral / cancelled / none
  alert: 'border-alert text-alert', // red — refund / overdue
} as const

// ── Helpers ───────────────────────────────────────────────────────────────────

const isPaidSignal = (o: OrderViewInput) => o.paymentStatus === 'paid' || o.status === 'paid'

/** Order needs no further staff action (shipped/completed or cancelled). */
export function isClosed(o: OrderViewInput): boolean {
  return o.status === 'shipped' || !!o.shippedAt || o.status === 'cancelled'
}

/** Manual bank-transfer order still awaiting deposit — the rows staff reconcile. */
export function isBankPending(o: OrderViewInput): boolean {
  return o.paymentMethod === 'bank_transfer' && o.paymentStatus !== 'paid' && (o.status === 'pending_payment' || o.status === 'quoted')
}

const STALE_DAYS = 30
/** Hold/deadline lapsed → staff must release (cancel) the stock. */
export function isOverdue(o: OrderViewInput, now: number): boolean {
  if (isClosed(o) || isPaidSignal(o)) return false
  if (o.paymentMethod === 'bank_transfer' && o.status === 'pending_payment' && o.bankDueAtMs && o.bankDueAtMs < now) return true
  if (o.status === 'pending_acceptance' && o.acceptanceExpiresAtMs && o.acceptanceExpiresAtMs < now) return true
  const ageMs = now - (o.createdAtMs ?? now)
  if ((o.status === 'pending_quote' || o.status === 'pending_approval') && ageMs > STALE_DAYS * 86_400_000) return true
  return false
}

function deriveKind(o: OrderViewInput): OrderKind {
  const items = o.items ?? []
  return {
    channel: o.origin === 'direct' ? 'direct' : 'ec',
    destination: o.isDomestic === false ? 'overseas' : 'domestic',
    production: items.some(i => i.madeToOrder) ? 'made_to_order' : 'stock',
    hasSample: items.some(i => i.kind === 'sample'),
  }
}

// ── Core ────────────────────────────────────────────────────────────────────

/** Project a stored order onto the presentation model. `now` is injectable for
 *  testability (defaults to Date.now()). Pure — no I/O, no mutation. */
export function deriveOrderView(o: OrderViewInput, now: number = Date.now()): OrderView {
  const kind = deriveKind(o)
  const s = o.status
  const paid = isPaidSignal(o)

  // — Phase + reason —
  let phase: OrderPhase
  let phaseReason: PhaseReason | undefined
  if (s === 'cancelled') phase = 'cancelled'
  else if (s === 'shipped' || o.shippedAt) phase = o.shipmentEmailedAt ? 'done' : 'shipped'
  else if (s === 'paid') phase = 'fulfilling'
  else if (s === 'quoted' || s === 'pending_payment') phase = 'awaiting_payment'
  else if (s === 'pending_quote') { phase = 'estimate'; phaseReason = 'quote_shipping' }
  else if (s === 'pending_approval') { phase = 'estimate'; phaseReason = 'production_approval' }
  else if (s === 'pending_acceptance') { phase = 'estimate'; phaseReason = 'customer_acceptance' }
  else phase = 'awaiting_payment' // defensive default for an unknown status

  const PHASE_LABEL: Record<OrderPhase, string> = {
    estimate: '見積・確認',
    awaiting_payment: 'お支払い待ち',
    fulfilling: '準備・発送',
    shipped: '発送済み',
    done: '完了',
    cancelled: '取消',
  }
  const PHASE_TONE: Record<OrderPhase, string> = {
    estimate: TONE.wait,
    awaiting_payment: TONE.wait,
    fulfilling: TONE.good,
    shipped: TONE.ship,
    done: TONE.good,
    cancelled: TONE.muted,
  }
  const REASON_LABEL: Record<PhaseReason, string> = {
    quote_shipping: '海外送料の見積待ち',
    production_approval: '受注生産の承認待ち',
    customer_acceptance: 'お客様の承諾待ち',
  }

  // — Payment track —
  let payment: PaymentTrack
  if (o.needsRefund || (s === 'cancelled' && o.paymentStatus === 'paid')) payment = 'refund_required'
  else if (paid) payment = 'paid'
  else if (o.transferReportedAt) payment = 'reported'
  else if (o.paymentStatus === 'invoiced') payment = 'invoiced'
  else if (o.paymentStatus === 'uninvoiced') payment = 'uninvoiced'
  else payment = 'unpaid'

  const PAYMENT_LABEL: Record<PaymentTrack, string> = {
    unpaid: '未入金',
    reported: '振込報告あり',
    paid: '入金済み',
    invoiced: '請求済',
    uninvoiced: '未請求',
    refund_required: '要返金',
  }
  const PAYMENT_TONE: Record<PaymentTrack, string> = {
    unpaid: TONE.wait,
    reported: TONE.wait,
    paid: TONE.good,
    invoiced: TONE.muted,
    uninvoiced: TONE.muted,
    refund_required: TONE.alert,
  }

  // — Fulfillment track —
  let fulfillment: FulfillmentTrack
  if (s === 'shipped' || o.shippedAt) fulfillment = o.shipmentEmailedAt ? 'notified' : 'shipped'
  else if (o.shipRequestedAt) fulfillment = 'ready_to_ship'
  else fulfillment = 'not_ready'

  const FULFILL_LABEL: Record<FulfillmentTrack, string> = {
    not_ready: '未発送',
    ready_to_ship: '要発送',
    shipped: '発送済み',
    notified: '通知済み',
  }
  const FULFILL_TONE: Record<FulfillmentTrack, string> = {
    not_ready: TONE.muted,
    ready_to_ship: TONE.good,
    shipped: TONE.ship,
    notified: TONE.good,
  }

  // — Alerts —
  const alerts: OrderAlert[] = []
  if (payment === 'refund_required') alerts.push('refund_required')
  if (isOverdue(o, now)) alerts.push('overdue')
  if (isBankPending(o) && o.transferReportedAt) alerts.push('transfer_reported')

  // — Next actions (the 1–2 operations actually valid right now) —
  const isExport = kind.destination === 'overseas'
  const nextActions: NextAction[] = []
  if (phase === 'estimate') {
    if (phaseReason === 'quote_shipping') nextActions.push({ id: 'quote', label: '送料見積を提示', roles: ['admin'] })
    else if (phaseReason === 'production_approval') nextActions.push({ id: 'approve', label: isExport ? '送料を入力して承認' : '承認して支払い案内', roles: ['admin'] })
    else if (phaseReason === 'customer_acceptance') nextActions.push({ id: 'accept_quote', label: '承諾を反映して確定', roles: ['admin'] })
  } else if (phase === 'awaiting_payment' && !paid) {
    if (o.paymentMethod === 'bank_transfer') nextActions.push({ id: 'confirm_payment', label: '入金確認', roles: ['admin', 'finance'] })
    else nextActions.push({ id: 'resend_payment_link', label: o.checkoutUrl ? '決済リンクを再発行' : '決済リンクを発行', roles: ['admin'] })
  } else if (phase === 'fulfilling') {
    nextActions.push({ id: 'mark_shipped', label: '出荷登録', roles: ['admin'] })
  } else if (phase === 'shipped') {
    nextActions.push({ id: 'notify_shipped', label: '発送通知メールを送信', roles: ['admin'] })
  }

  return {
    phase,
    phaseReason,
    phaseLabel: PHASE_LABEL[phase],
    phaseReasonLabel: phaseReason ? REASON_LABEL[phaseReason] : undefined,
    phaseTone: PHASE_TONE[phase],
    payment,
    paymentLabel: PAYMENT_LABEL[payment],
    paymentTone: PAYMENT_TONE[payment],
    fulfillment,
    fulfillmentLabel: FULFILL_LABEL[fulfillment],
    fulfillmentTone: FULFILL_TONE[fulfillment],
    kind,
    alerts,
    nextActions,
    closed: s === 'cancelled',
  }
}

// ── Back-compat label helpers ─────────────────────────────────────────────────
// Reproduce the EXACT strings/tones the list page showed before Phase 0, so the
// current 一覧 keeps its appearance while sourcing labels from this one module.
// The list is redesigned to the two-track chips in Phase 2; until then these keep
// pixel parity.

/** Legacy "支払い状況" badge (a lifecycle+payment blend, as the old list showed). */
export function legacyPaymentStateLabel(o: OrderViewInput): { label: string; tone: string } {
  if (o.status === 'cancelled') return { label: '取消', tone: TONE.muted }
  if (o.status === 'pending_acceptance') return { label: '承諾待ち（見積）', tone: TONE.wait }
  if (o.status === 'pending_approval') return { label: '承認待ち', tone: TONE.wait }
  if (o.status === 'pending_quote') return { label: '見積待ち', tone: TONE.wait }
  if (o.status === 'quoted') return { label: '支払い待ち（見積済）', tone: TONE.wait }
  if (isPaidSignal(o)) return { label: '支払い済み', tone: TONE.good }
  return { label: '支払い待ち', tone: TONE.wait }
}

/** Legacy "発送状況" badge. */
export function legacyShippingStateLabel(o: OrderViewInput): { label: string; tone: string } {
  if (o.status === 'cancelled') return { label: '—', tone: TONE.muted }
  if (o.status === 'shipped' || o.shippedAt) return { label: '出荷済み', tone: TONE.ship }
  return { label: '未発送', tone: TONE.muted }
}

/** Kind badges as short labels for chips, e.g. ['EC','海外','受注生産','サンプル']. */
export function kindBadges(kind: OrderKind): string[] {
  const out = [kind.channel === 'direct' ? '直販' : 'EC', kind.destination === 'overseas' ? '海外' : '国内']
  if (kind.production === 'made_to_order') out.push('受注生産')
  if (kind.hasSample) out.push('サンプル')
  return out
}
