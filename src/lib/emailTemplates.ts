// Editable automated-email templates. Mirrors sabo-wholesale/src/lib/emailTemplates.ts
// (the wholesale app reads settings/email_templates and renders the actual emails).
// Keep the keys / defaults in sync with that file.

export type EmailEventKey =
  | 'order_paid'
  | 'order_bank'
  | 'order_approval'
  | 'order_quote'
  | 'quote_bank'
  | 'quote_card'
  | 'shipment'
  | 'order_cancelled'

export interface EmailTemplate {
  subject: string
  body: string
}

export interface EmailEventMeta {
  key: EmailEventKey
  label: string
  description: string
}

export const EMAIL_PLACEHOLDERS: { token: string; desc: string }[] = [
  { token: '{companyName}', desc: 'お客様の会社名' },
  { token: '{orderNumber}', desc: '注文番号' },
  { token: '{total}', desc: '合計金額（税込・¥表記）' },
  { token: '{dueDate}', desc: 'お振込期限（該当時のみ）' },
  { token: '{carrier}', desc: '配送業者（発送完了メール）' },
  { token: '{trackingNumber}', desc: '追跡番号（発送完了メール）' },
  { token: '{checkoutUrl}', desc: 'カード決済リンク（送料確定・カード）' },
  { token: '{myPageUrl}', desc: 'マイページURL' },
]

export const EMAIL_EVENTS: EmailEventMeta[] = [
  { key: 'order_bank', label: '振込案内（国内・銀行振込の注文時）', description: '国内の銀行振込注文を受け付けた直後。請求書PDFを添付し、振込先・流れを自動付加。' },
  { key: 'order_approval', label: '受注生産・確認中', description: '受注生産品を含む注文の受付。納期・支払いは後日案内。' },
  { key: 'order_quote', label: '海外見積受付', description: '海外発送注文の受付。送料確定後に支払い案内を送る旨を通知。' },
  { key: 'quote_bank', label: '送料確定・お振込案内（海外・銀行振込）', description: '送料確定時。Proforma Invoiceを添付し振込先を自動付加。' },
  { key: 'quote_card', label: '送料確定・お支払いリンク（海外・カード）', description: '送料確定時。Proforma Invoiceを添付し決済リンクを案内。' },
  { key: 'order_paid', label: '入金確認', description: 'カード決済完了／銀行振込の入金確認時。領収書等は発送時に送付する旨を自動付加。' },
  { key: 'shipment', label: '発送完了', description: '発送通知。追跡情報と添付書類（領収書/納品書兼領収書/通関書類）を自動付加。' },
  { key: 'order_cancelled', label: 'キャンセル', description: '注文キャンセル時。キャンセル理由に応じた案内を自動付加。' },
]

export const DEFAULT_EMAIL_TEMPLATES: Record<EmailEventKey, EmailTemplate> = {
  order_paid: {
    subject: 'SABO Wholesale — ご注文ありがとうございます / Order confirmed ({orderNumber})',
    body:
      '<p>{companyName} 様</p>' +
      '<p>ご注文・お支払いを確認いたしました。誠にありがとうございます。<br/>' +
      'We have received your order and payment. Thank you.</p>',
  },
  order_bank: {
    subject: 'SABO Wholesale — ご注文を受け付けました（お振込のご案内）/ Order received ({orderNumber})',
    body:
      '<p>{companyName} 様</p>' +
      '<p>ご注文を受け付けました。下記の合計金額を、お振込先までお支払いください。請求書（日本語・英語のPDF）を添付しております。<br/>' +
      'We have received your order. Please transfer the total below to our bank account. The invoice PDF is attached in Japanese and English.</p>',
  },
  order_approval: {
    subject: 'SABO Wholesale — ご注文を受け付けました（受注生産・確認中）/ Order received ({orderNumber})',
    body:
      '<p>{companyName} 様</p>' +
      '<p>受注生産品を含むご注文を受け付けました。内容を確認のうえ、納期とお支払いのご案内を改めてお送りします（この時点ではご請求はありません）。<br/>' +
      'We have received your made-to-order request. After we review it, we will send the lead time and payment details. You have not been charged yet.</p>',
  },
  order_quote: {
    subject: 'SABO Wholesale — ご注文を受け付けました（送料お見積り中）/ Order received ({orderNumber})',
    body:
      '<p>{companyName} 様</p>' +
      '<p>海外発送のご注文を受け付けました。送料を確定のうえ、お支払いのご案内を改めてお送りします（この時点ではご請求はありません）。<br/>' +
      'We have received your order. We will confirm the shipping cost and then send payment details. You have not been charged yet.</p>',
  },
  quote_bank: {
    subject: 'SABO Wholesale — お振込のご案内 / Bank transfer ({orderNumber})',
    body:
      '<p>{companyName} 様</p>' +
      '<p>送料が確定しました。下記の明細をご確認のうえ、合計金額をお振込先までお支払いください。Proforma Invoice（PDF）を添付しております。<br/>' +
      'Your shipping cost is confirmed. Please review the details below and transfer the total to our bank account. The Proforma Invoice (PDF) is attached:</p>',
  },
  quote_card: {
    subject: 'SABO Wholesale — お支払いのご案内 / Payment link ({orderNumber})',
    body:
      '<p>{companyName} 様</p>' +
      '<p>送料が確定しました。下記の明細をご確認のうえ、商品代金＋送料のお支払いをお願いいたします。Proforma Invoice（PDF）を添付しております。<br/>' +
      'Your shipping cost is confirmed. Please review the details below and complete payment (goods + shipping). The Proforma Invoice (PDF) is attached:</p>' +
      '<p><a href="{checkoutUrl}">{checkoutUrl}</a></p>',
  },
  shipment: {
    subject: 'SABO Wholesale — ご注文を発送しました / Your order has shipped ({orderNumber})',
    body:
      '<p>{companyName} 様</p>' +
      '<p>ご注文を発送いたしました。<br/>Your order has been shipped.</p>',
  },
  order_cancelled: {
    subject: 'SABO Wholesale — ご注文のキャンセル / Order cancelled ({orderNumber})',
    body: '<p>{companyName} 様</p>',
  },
}
