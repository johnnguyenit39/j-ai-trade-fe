import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth'
import { auth, isFirebaseConfigured } from '../firebase'

interface AuthState {
  user: User | null
  /** True until the first auth-state resolution (show a loading screen). */
  loading: boolean
  configured: boolean
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  // If Firebase isn't configured there's nothing to wait for — skip loading.
  const [loading, setLoading] = useState<boolean>(isFirebaseConfigured)

  useEffect(() => {
    if (!auth) return
    // Fires once on load with the restored session (or null), then on changes.
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u)
      setLoading(false)
    })
    return unsub
  }, [])

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      configured: isFirebaseConfigured,
      signIn: async (email, password) => {
        if (!auth) throw new Error('Firebase chưa được cấu hình.')
        await signInWithEmailAndPassword(auth, email, password)
      },
      signUp: async (email, password) => {
        if (!auth) throw new Error('Firebase chưa được cấu hình.')
        await createUserWithEmailAndPassword(auth, email, password)
      },
      logout: async () => {
        if (!auth) return
        await signOut(auth)
      },
    }),
    [user, loading],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
