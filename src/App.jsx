import React from 'react'
import { AuthProvider, useAuth, isStaffRoute } from './lib/auth'
import Login from './pages/Login'
import AdminView from './pages/AdminView'
import StaffView from './pages/StaffView'

function AppInner() {
  const { user, isAdmin, loading, staffAutoLoginIssue } = useAuth()

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#aaa', fontSize: 14 }}>
        Laddar...
      </div>
    )
  }

  if (isStaffRoute) {
    if (!user) {
      const detail = staffAutoLoginIssue === 'missing_env'
        ? 'REACT_APP_STAFF_EMAIL / REACT_APP_STAFF_PASSWORD är inte satta i Vercel.'
        : staffAutoLoginIssue?.startsWith('signin_error:')
          ? `Supabase avvisade inloggningen: ${staffAutoLoginIssue.slice('signin_error:'.length)}`
          : 'Okänt fel.'
      return (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#aaa', fontSize: 14, padding: 24, textAlign: 'center' }}>
          <div>
            <div>Automatisk inloggning för personalvyn misslyckades.</div>
            <div style={{ marginTop: 8, fontSize: 12, color: '#c0392b' }}>{detail}</div>
          </div>
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
