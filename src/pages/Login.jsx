import React, { useState } from 'react'
import { signIn } from '../lib/supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error } = await signIn(email, password)
    if (error) setError('Fel e-post eller lösenord')
    setLoading(false)
  }

  return (
    <div style={styles.outer}>
      <div style={styles.card}>
        <div style={styles.logo}>
          <span style={styles.logoText}>Hotell Vänersborg</span>
          <span style={styles.logoSub}>Personalportal</span>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={styles.field}>
            <label style={styles.label}>E-post</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              style={styles.input}
              placeholder="din@email.se"
              required
            />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>Lösenord</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              style={styles.input}
              placeholder="••••••••"
              required
            />
          </div>
          {error && <p style={styles.error}>{error}</p>}
          <button type="submit" style={styles.btn} disabled={loading}>
            {loading ? 'Loggar in...' : 'Logga in'}
          </button>
        </form>
      </div>
    </div>
  )
}

const styles = {
  outer: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#f5f4f0',
  },
  card: {
    background: '#fff',
    border: '1px solid #e0ddd5',
    borderRadius: 12,
    padding: '2rem 2.5rem',
    width: 340,
    boxShadow: '0 2px 16px rgba(0,0,0,0.06)',
  },
  logo: {
    marginBottom: '1.75rem',
    textAlign: 'center',
  },
  logoText: {
    display: 'block',
    fontSize: 20,
    fontWeight: 600,
    color: '#1a1a1a',
    letterSpacing: '-0.02em',
  },
  logoSub: {
    display: 'block',
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },
  field: { marginBottom: '1rem' },
  label: {
    display: 'block',
    fontSize: 12,
    fontWeight: 500,
    color: '#555',
    marginBottom: 5,
  },
  input: {
    width: '100%',
    padding: '8px 10px',
    border: '1px solid #ddd',
    borderRadius: 7,
    fontSize: 14,
    outline: 'none',
    boxSizing: 'border-box',
  },
  error: {
    color: '#c0392b',
    fontSize: 13,
    marginBottom: '0.75rem',
  },
  btn: {
    width: '100%',
    padding: '10px',
    background: '#1a1a1a',
    color: '#fff',
    border: 'none',
    borderRadius: 7,
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
    marginTop: 4,
  },
}
