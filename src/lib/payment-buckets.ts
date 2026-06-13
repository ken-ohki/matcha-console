// Shared aging-bucket logic for 入金管理 (receivables) and 支払管理 (payables).

import { endOfMonthIso, endOfNextMonthIso } from '@/lib/format'

// 要確認 (actionNeeded) merges overdue + due-this-month into one urgent bucket.
export type Bucket = 'actionNeeded' | 'nextMonth' | 'later' | 'noDate' | 'paid'

export const BUCKET_ORDER_OPEN: Bucket[] = ['actionNeeded', 'nextMonth', 'later', 'noDate']
export const BUCKET_ORDER_ALL: Bucket[] = [...BUCKET_ORDER_OPEN, 'paid']

export const BUCKET_COLORS: Record<Bucket, string> = {
  actionNeeded: 'border-red-300 bg-red-50',
  nextMonth: 'border-amber-300 bg-amber-50',
  later: 'border-[#d9d1be] bg-white',
  noDate: 'border-gray-200 bg-gray-50',
  paid: 'border-emerald-200 bg-emerald-50/30',
}

const BASE_LABELS: Record<Exclude<Bucket, 'paid'>, string> = {
  actionNeeded: '要確認',
  nextMonth: '来月期限',
  later: 'それ以降',
  noDate: '期日未設定',
}

/** Build labels with a context-specific 'paid' label (入金済 / 支払済). */
export function makeBucketLabels(paidLabel: string): Record<Bucket, string> {
  return { ...BASE_LABELS, paid: paidLabel }
}

/**
 * Classify a record by its due date and paid state.
 * Overdue and due-this-month both fall into 要確認 (actionNeeded).
 */
export function bucketOf(dueDate: string | undefined, isPaid: boolean): Bucket {
  if (isPaid) return 'paid'
  if (!dueDate) return 'noDate'
  const eom = endOfMonthIso(new Date())
  const eonm = endOfNextMonthIso(new Date())
  if (dueDate <= eom) return 'actionNeeded'   // overdue or due this month
  if (dueDate <= eonm) return 'nextMonth'
  return 'later'
}
