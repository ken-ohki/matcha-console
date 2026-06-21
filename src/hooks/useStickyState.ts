'use client'

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'

/**
 * useState backed by sessionStorage, so list-page tab/filter selections survive
 * navigating into a detail page and back. Keyed per page+field.
 */
export function useStickyState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(initial)
  const loaded = useRef(false)

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(key)
      if (raw != null) setValue(JSON.parse(raw) as T)
    } catch {
      /* ignore corrupt/full storage */
    }
    loaded.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  useEffect(() => {
    if (!loaded.current) return
    try {
      sessionStorage.setItem(key, JSON.stringify(value))
    } catch {
      /* ignore */
    }
  }, [key, value])

  return [value, setValue]
}

/** Like useStickyState but for a Set<string> (stored as an array). */
export function useStickySet(key: string): [Set<string>, Dispatch<SetStateAction<Set<string>>>] {
  const [set, setSet] = useState<Set<string>>(new Set())
  const loaded = useRef(false)

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(key)
      if (raw != null) setSet(new Set(JSON.parse(raw) as string[]))
    } catch {
      /* ignore */
    }
    loaded.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  useEffect(() => {
    if (!loaded.current) return
    try {
      sessionStorage.setItem(key, JSON.stringify([...set]))
    } catch {
      /* ignore */
    }
  }, [key, set])

  return [set, setSet]
}
