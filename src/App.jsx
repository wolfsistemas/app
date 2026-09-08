import React from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import Landing from './pages/Landing.jsx'
import Auth from './pages/Auth.jsx'
import Onboarding from './pages/Onboarding.jsx'
import Dashboard from './pages/Dashboard.jsx'
import PublicStore from './pages/PublicStore.jsx'
import Analytics from './components/Analytics.jsx'
import { useAuth } from './lib/AuthContext.jsx'

function Guard({ children, needStore }) {
  const { user, store, loading } = useAuth()
  if (loading) return <div className="wrap" style={{ padding: 48 }}>Carregando...</div>
  if (!user) return <Navigate to="/entrar" replace />
  if (needStore && !store) return <Navigate to="/comecar" replace />
  return children
}

export default function App() {
  return (
    <>
      <Analytics />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/entrar" element={<Auth mode="login" />} />
        <Route path="/criar" element={<Auth mode="signup" />} />
        <Route
          path="/comecar"
          element={
            <Guard>
              <Onboarding />
            </Guard>
          }
        />
        <Route
          path="/painel"
          element={
            <Guard needStore>
              <Dashboard />
            </Guard>
          }
        />
        <Route path="/:slug" element={<PublicStore />} />
      </Routes>
    </>
  )
}
