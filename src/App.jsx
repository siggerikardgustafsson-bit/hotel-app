import React from 'react'
import { AuthProvider, useAuth, isStaffRoute } from './lib/auth'
import Login from './pages/Login'
import AdminView from './pages/AdminView'
import StaffView from './pages/StaffView'

function AppInner() {
  const { user, isAdmin, loading } = useAuth()

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#aaa', fontSize: 14 }}>
        Laddar...
      </div>
    )
  }

  if (isStaffRoute) {
    if (!user) {
      return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#aaa', fontSize: 14, padding: 24, textAlign: 'center' }}>
          Automatisk inloggning för personalvyn är inte konfigurerad. Kontakta admin.
        </div>
      )
    }
    return <StaffView />
  }

  if (!user) return <Login />
  if (isAdmin) return <AdminView />
  return <StaffView />
}

export default function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  )
}
