'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { AuthUser } from '@/types'
import { getServices } from '@/lib/services'

interface AuthContextValue {
  user: AuthUser | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  loginWithGoogle: () => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let unsubscribe: (() => void) | undefined

    getServices().then(services => {
      unsubscribe = services.auth.onAuthStateChanged(u => {
        setUser(u)
        setLoading(false)
      })
    })

    return () => {
      unsubscribe?.()
    }
  }, [])

  const login = async (email: string, password: string) => {
    const services = await getServices()
    const authUser = await services.auth.login(email, password)
    setUser(authUser)
  }

  const loginWithGoogle = async () => {
    const services = await getServices()
    const authUser = await services.auth.loginWithGoogle()
    setUser(authUser)
  }

  const logout = async () => {
    const services = await getServices()
    await services.auth.logout()
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, loginWithGoogle, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
