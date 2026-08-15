import React, { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './supabase'

const AuthContext = createContext(null)

// Admin email – byt till din faktiska e-post
const ADMIN_EMAIL = process.env.REACT_APP_ADMIN_EMAIL || 'admin@hotellvanersborg.se'

// Delat personalkonto – används för att logga in automatiskt utan
// inloggningsskärm på /personal. Kontot skapas manuellt i Supabase
// Dashboard → Authentication → Users, och e-post/lösenord sätts sedan
// här via env-variabler.
const STAFF_EMAIL = process.env.REACT_APP_STAFF_EMAIL
const STAFF_PASSWORD = process.env.REACT_APP_STAFF_PASSWORD

export const STAFF_ROUTE = '/personal'
export const isStaffRoute = typeof window !== 'undefined' && window.location.pathname === STAFF_ROUTE

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function init() {
      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        setUser(session.user)
        setLoading(false)
        return
      }

      if (isStaffRoute && STAFF_EMAIL && STAFF_PASSWORD) {
        const { data } = await supabase.auth.signInWithPassword({ email: STAFF_EMAIL, password: STAFF_PASSWORD })
        setUser(data?.user ?? null)
        setLoading(false)
        return
      }

      setLoading(false)
    }
    init()

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  const isAdmin = user?.email === ADMIN_EMAIL

  return (
    <AuthContext.Provider value={{ user, isAdmin, loading }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
