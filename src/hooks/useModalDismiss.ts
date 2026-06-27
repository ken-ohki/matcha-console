'use client'

import { useEffect } from 'react'

/**
 * Shared modal behavior: while `active`, close on Escape and lock background
 * scroll. Keeps modal dismissal consistent across the app without rewriting each
 * modal into a wrapper component.
 */
export function useModalDismiss(active: boolean, onClose: () => void): void {
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [active, onClose])
}
