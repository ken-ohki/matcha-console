'use client'

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import { useModalDismiss } from '@/hooks/useModalDismiss'

/**
 * App-wide confirm dialog + toast notifications, so destructive confirmations and
 * result messages share one consistent in-app UI instead of window.confirm/alert.
 *
 *   const { confirm, notify } = useConfirm()
 *   if (!(await confirm({ message: '削除しますか？', danger: true }))) return
 *   notify('保存しました', 'success')
 */

export interface ConfirmOptions {
  title?: string
  message: string // \n is rendered as line breaks
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

type Tone = 'info' | 'success' | 'error'
interface Toast {
  id: number
  message: string
  tone: Tone
}

interface ConfirmValue {
  confirm: (opts: ConfirmOptions) => Promise<boolean>
  notify: (message: string, tone?: Tone) => void
}

const ConfirmCtx = createContext<ConfirmValue | null>(null)

interface DialogState extends ConfirmOptions {
  resolve: (ok: boolean) => void
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const toastId = useRef(0)

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>(resolve => {
        setDialog({ ...opts, resolve })
      }),
    [],
  )

  const close = useCallback(
    (ok: boolean) => {
      setDialog(prev => {
        prev?.resolve(ok)
        return null
      })
    },
    [],
  )

  const notify = useCallback((message: string, tone: Tone = 'info') => {
    const id = ++toastId.current
    setToasts(prev => [...prev, { id, message, tone }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4500)
  }, [])

  useModalDismiss(!!dialog, useCallback(() => close(false), [close]))

  return (
    <ConfirmCtx.Provider value={{ confirm, notify }}>
      {children}

      {dialog && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
          onClick={() => close(false)}
          role="presentation"
        >
          <div
            className="w-full max-w-md rounded-2xl border border-line bg-canvas p-6 shadow-xl"
            onClick={e => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            {dialog.title && <h2 className="mb-2 text-lg font-semibold text-ink">{dialog.title}</h2>}
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-graphite">{dialog.message}</p>
            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => close(false)}
                className="rounded-xl border border-line px-4 py-2 text-sm text-graphite hover:bg-bone"
              >
                {dialog.cancelLabel ?? 'キャンセル'}
              </button>
              <button
                type="button"
                autoFocus
                onClick={() => close(true)}
                className={
                  dialog.danger
                    ? 'rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700'
                    : 'rounded-xl bg-ink px-4 py-2 text-sm font-medium text-canvas hover:opacity-90'
                }
              >
                {dialog.confirmLabel ?? 'OK'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-[70] flex flex-col gap-2">
          {toasts.map(t => (
            <div
              key={t.id}
              role="status"
              className={
                'flex items-start gap-2 rounded-xl border px-4 py-3 text-sm shadow-lg ' +
                (t.tone === 'error'
                  ? 'border-red-200 bg-red-50 text-red-800'
                  : t.tone === 'success'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : 'border-line bg-canvas text-ink')
              }
            >
              {t.tone === 'error' ? (
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              ) : t.tone === 'success' ? (
                <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
              ) : (
                <Info size={16} className="mt-0.5 shrink-0" />
              )}
              <span className="whitespace-pre-wrap">{t.message}</span>
              <button
                type="button"
                onClick={() => setToasts(prev => prev.filter(x => x.id !== t.id))}
                className="ml-2 shrink-0 text-mist hover:text-ink"
                aria-label="閉じる"
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </ConfirmCtx.Provider>
  )
}

export function useConfirm(): ConfirmValue {
  const ctx = useContext(ConfirmCtx)
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider')
  return ctx
}
