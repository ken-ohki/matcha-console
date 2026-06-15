'use client'

import { Document, Page, View, Text, StyleSheet, Font } from '@react-pdf/renderer'
import type { DocumentData, DocumentTotals, DocumentType } from '@/lib/invoice'
import { formatYen } from '@/lib/invoice'
import type { IssuerInfo } from '@/lib/services'

// Register a Japanese-capable font (react-pdf's built-ins have no CJK glyphs).
let fontsRegistered = false
function ensureFonts() {
  if (fontsRegistered) return
  Font.register({
    family: 'NotoSansJP',
    fonts: [
      { src: '/fonts/NotoSansJP-Regular.ttf', fontWeight: 'normal' },
      { src: '/fonts/NotoSansJP-Bold.ttf', fontWeight: 'bold' },
    ],
  })
  // Japanese has no spaces, so without a callback long CJK strings never wrap and
  // overflow their box. Split into break units: keep Latin/number/punctuation runs
  // together, and make every other (CJK) character its own breakable unit.
  Font.registerHyphenationCallback(word => {
    const segments = word.match(/[A-Za-z0-9.,@:%/+\-_()'"#&¥$]+|\s+|[^A-Za-z0-9\s]/g)
    return segments && segments.length > 0 ? segments : [word]
  })
  fontsRegistered = true
}

const INK = '#173c2a'
const MUTED = '#68756c'
const LINE = '#d9d1be'

const styles = StyleSheet.create({
  page: {
    fontFamily: 'NotoSansJP',
    fontSize: 9,
    color: INK,
    paddingTop: 36,
    paddingBottom: 44,
    paddingHorizontal: 40,
    lineHeight: 1.4,
  },
  title: { fontSize: 22, fontWeight: 'bold', textAlign: 'center', letterSpacing: 6, marginBottom: 4 },
  titleEn: { fontSize: 20, fontWeight: 'bold', textAlign: 'center', letterSpacing: 2, marginBottom: 4 },
  issueDate: { fontSize: 9, textAlign: 'right', color: MUTED, marginBottom: 12 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 16, marginBottom: 14 },
  recipientCol: { flex: 1, paddingRight: 12 },
  issuerCol: { width: 220, alignItems: 'flex-end' },
  recipientName: { fontSize: 14, fontWeight: 'bold', borderBottomWidth: 1.5, borderBottomColor: INK, paddingBottom: 3 },
  small: { fontSize: 8, color: MUTED },
  intro: { fontSize: 9, marginTop: 10 },
  issuerName: { fontSize: 11, fontWeight: 'bold' },
  issuerLine: { fontSize: 8, color: MUTED, textAlign: 'right' },
  metaWrap: { marginBottom: 12 },
  metaRow: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#eee', paddingVertical: 2 },
  metaLabel: { width: 90, fontSize: 8, color: MUTED },
  metaValue: { flex: 1, fontSize: 9 },
  amountBand: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderTopWidth: 1.5, borderBottomWidth: 1.5, borderColor: INK, paddingVertical: 8, marginBottom: 14,
  },
  amountLabel: { fontSize: 10, fontWeight: 'bold', flexShrink: 0, marginRight: 8 },
  amountValue: { fontSize: 18, fontWeight: 'bold', textAlign: 'right' },
  amountNote: { fontSize: 8, color: MUTED, flexShrink: 0 },
  table: { borderWidth: 0.5, borderColor: LINE, borderRadius: 2 },
  th: { flexDirection: 'row', backgroundColor: '#f3f1e8', borderBottomWidth: 0.5, borderBottomColor: LINE },
  tr: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#eee' },
  cell: { paddingVertical: 4, paddingHorizontal: 5, fontSize: 8.5 },
  cellHead: { paddingVertical: 5, paddingHorizontal: 5, fontSize: 8, color: MUTED, fontWeight: 'bold' },
  colDesc: { flex: 1 },
  colMark: { width: 26, textAlign: 'center' },
  colQty: { width: 50, textAlign: 'right' },
  colUnit: { width: 38, textAlign: 'center' },
  colPrice: { width: 70, textAlign: 'right' },
  colAmount: { width: 80, textAlign: 'right' },
  summaryWrap: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 10 },
  summaryBox: { width: 240 },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  sumRowTotal: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderTopWidth: 1, borderTopColor: INK, marginTop: 2 },
  sumLabel: { fontSize: 8.5, color: MUTED },
  sumValue: { fontSize: 9 },
  sumTotalLabel: { fontSize: 10, fontWeight: 'bold' },
  sumTotalValue: { fontSize: 12, fontWeight: 'bold' },
  notes: { marginTop: 16 },
  notesLabel: { fontSize: 8, color: MUTED, marginBottom: 2 },
  notesBody: { fontSize: 8.5 },
  taxNote: { fontSize: 7.5, color: MUTED, marginTop: 6 },
  footer: {
    position: 'absolute', bottom: 20, left: 40, right: 40,
    textAlign: 'center', fontSize: 7, color: MUTED,
  },
  termsTitle: { fontSize: 12, fontWeight: 'bold', marginBottom: 8 },
  termHeading: { fontSize: 9, fontWeight: 'bold', marginTop: 6 },
  termBody: { fontSize: 8, color: '#3a463d', marginTop: 1 },
})

export interface SaleDocumentPdfProps {
  doc: DocumentData
  totals: DocumentTotals
  issuer: IssuerInfo
  isJa: boolean
  labels: { title: string; intro: string; amountLabel: string }
  type: DocumentType
  includeTerms: boolean
  terms: { heading: string; body: string }[]
}

export function SaleDocumentPdf({ doc, totals, issuer, isJa, labels, type, includeTerms, terms }: SaleDocumentPdfProps) {
  ensureFonts()
  const showTax = !doc.taxExempt
  const headTotal = doc.taxExempt ? totals.subtotal : totals.total
  const amountNote = isJa ? '（税込）' : doc.taxExempt ? '(tax exempt)' : '(tax incl.)'
  const attachTerms = !isJa && (type === 'invoice' || type === 'quotation') && includeTerms && terms.length > 0

  const metaRows: { label: string; value: string }[] = []
  metaRows.push({ label: isJa ? '案件' : 'Project', value: doc.projectName })
  if (type === 'quotation') {
    if (doc.validUntil) metaRows.push({ label: isJa ? '有効期限' : 'Valid Until', value: doc.validUntil })
    if (doc.terms) metaRows.push({ label: isJa ? '条件' : 'Terms', value: doc.terms })
  }
  if (type === 'delivery') {
    if (doc.deliveryDate) metaRows.push({ label: isJa ? '納品日' : 'Delivery Date', value: doc.deliveryDate })
    if (doc.deliveryPlace) metaRows.push({ label: isJa ? '納品場所' : 'Delivery Place', value: doc.deliveryPlace })
  }
  if (type === 'invoice') {
    if (doc.paymentDueDate) metaRows.push({ label: isJa ? '支払期限' : 'Payment Due', value: doc.paymentDueDate })
    if (doc.paymentDestination) metaRows.push({ label: isJa ? '振込先' : 'Bank Information', value: doc.paymentDestination })
    if (!isJa && doc.paymentTerms) metaRows.push({ label: 'Terms & Conditions', value: doc.paymentTerms })
  }

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={isJa ? styles.title : styles.titleEn}>{labels.title}</Text>
        <Text style={styles.issueDate}>{(isJa ? '発行日：' : 'Issue Date: ') + doc.issueDate}</Text>

        <View style={styles.headerRow}>
          <View style={styles.recipientCol}>
            <Text style={styles.recipientName}>
              {(!isJa ? 'To: ' : '') + doc.recipientName + (isJa && doc.recipientHonorific ? `　${doc.recipientHonorific}` : '')}
            </Text>
            {isJa && !!doc.recipientPostalCode && <Text style={[styles.small, { marginTop: 3 }]}>{doc.recipientPostalCode}</Text>}
            {!!doc.recipientAddress && <Text style={styles.small}>{doc.recipientAddress}</Text>}
            <Text style={styles.intro}>{labels.intro}</Text>
          </View>
          <View style={styles.issuerCol}>
            <Text style={styles.issuerName}>{isJa ? issuer.company : issuer.companyEn}</Text>
            {isJa && !!issuer.postalCode && <Text style={styles.issuerLine}>{issuer.postalCode}</Text>}
            <Text style={styles.issuerLine}>{isJa ? issuer.address : issuer.addressEn}</Text>
            <Text style={styles.issuerLine}>{(isJa ? 'TEL：' : 'TEL: ') + issuer.tel}</Text>
            <Text style={styles.issuerLine}>{(isJa ? 'E-Mail：' : 'Email: ') + issuer.email}</Text>
            {isJa && !!issuer.registrationNumber && <Text style={styles.issuerLine}>{'登録番号：' + issuer.registrationNumber}</Text>}
          </View>
        </View>

        {metaRows.length > 0 && (
          <View style={styles.metaWrap}>
            {metaRows.map((m, i) => (
              <View key={i} style={styles.metaRow}>
                <Text style={styles.metaLabel}>{m.label}</Text>
                <Text style={styles.metaValue}>{m.value || '-'}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={styles.amountBand}>
          <Text style={styles.amountLabel}>{labels.amountLabel}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, flexShrink: 1, justifyContent: 'flex-end' }}>
            <Text style={styles.amountValue}>¥ {formatYen(headTotal)}</Text>
            <Text style={styles.amountNote}>{amountNote}</Text>
          </View>
        </View>

        {/* Line table */}
        <View style={styles.table}>
          <View style={styles.th}>
            <Text style={[styles.cellHead, styles.colDesc]}>{isJa ? '品目' : 'Description'}</Text>
            {showTax && <Text style={[styles.cellHead, styles.colMark]}>8%</Text>}
            <Text style={[styles.cellHead, styles.colQty]}>{isJa ? '数量' : 'Qty'}</Text>
            <Text style={[styles.cellHead, styles.colUnit]}>{isJa ? '単位' : 'Unit'}</Text>
            <Text style={[styles.cellHead, styles.colPrice]}>{isJa ? '単価' : 'Unit Price'}</Text>
            <Text style={[styles.cellHead, styles.colAmount]}>{isJa ? '金額' : 'Amount'}</Text>
          </View>
          {doc.lines.map(line => {
            const amount = (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0)
            return (
              <View key={line.id} style={styles.tr} wrap={false}>
                <Text style={[styles.cell, styles.colDesc]}>{line.description}</Text>
                {showTax && <Text style={[styles.cell, styles.colMark]}>{line.isReducedRate ? '✓' : ''}</Text>}
                <Text style={[styles.cell, styles.colQty]}>{line.quantity}</Text>
                <Text style={[styles.cell, styles.colUnit]}>{line.unit}</Text>
                <Text style={[styles.cell, styles.colPrice]}>¥{formatYen(Number(line.unitPrice) || 0)}</Text>
                <Text style={[styles.cell, styles.colAmount]}>¥{formatYen(amount)}</Text>
              </View>
            )
          })}
        </View>

        {/* Tax summary */}
        {showTax ? (
          <View style={styles.summaryWrap}>
            <View style={styles.summaryBox}>
              <View style={styles.sumRow}>
                <Text style={styles.sumLabel}>{isJa ? '小計（税抜）' : 'Subtotal'}</Text>
                <Text style={styles.sumValue}>¥{formatYen(totals.subtotal)}</Text>
              </View>
              {totals.reducedSubtotal > 0 && (
                <View style={styles.sumRow}>
                  <Text style={styles.sumLabel}>{(isJa ? '8%対象 / 消費税' : '8% target / tax')}</Text>
                  <Text style={styles.sumValue}>¥{formatYen(totals.reducedSubtotal)} / ¥{formatYen(totals.reducedTax)}</Text>
                </View>
              )}
              {totals.standardSubtotal > 0 && (
                <View style={styles.sumRow}>
                  <Text style={styles.sumLabel}>{(isJa ? '10%対象 / 消費税' : '10% target / tax')}</Text>
                  <Text style={styles.sumValue}>¥{formatYen(totals.standardSubtotal)} / ¥{formatYen(totals.standardTax)}</Text>
                </View>
              )}
              <View style={styles.sumRowTotal}>
                <Text style={styles.sumTotalLabel}>{isJa ? '合計（税込）' : 'Total'}</Text>
                <Text style={styles.sumTotalValue}>¥{formatYen(totals.total)}</Text>
              </View>
            </View>
          </View>
        ) : (
          <Text style={styles.taxNote}>{isJa ? '※ 免税取引' : '* Tax-exempt transaction'}</Text>
        )}

        {showTax && <Text style={styles.taxNote}>{isJa ? '* 軽減税率対象商品' : '* Reduced-rate item'}</Text>}

        {!!doc.notes && (
          <View style={styles.notes}>
            <Text style={styles.notesLabel}>{isJa ? '備考' : 'Notes'}</Text>
            <Text style={styles.notesBody}>{doc.notes}</Text>
          </View>
        )}

        <Text style={styles.footer} fixed render={({ pageNumber, totalPages }) => `${isJa ? issuer.company : issuer.companyEn}　${pageNumber} / ${totalPages}`} />
      </Page>

      {attachTerms && (
        <Page size="A4" style={styles.page}>
          <Text style={styles.termsTitle}>Terms &amp; Conditions of Sale</Text>
          {terms.map((t, i) => (
            <View key={i} wrap={false}>
              <Text style={styles.termHeading}>{t.heading}</Text>
              <Text style={styles.termBody}>{t.body}</Text>
            </View>
          ))}
          <Text style={styles.footer} fixed render={({ pageNumber, totalPages }) => `${issuer.companyEn}　${pageNumber} / ${totalPages}`} />
        </Page>
      )}
    </Document>
  )
}
