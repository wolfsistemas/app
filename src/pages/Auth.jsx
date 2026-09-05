import React, { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import Nav from '../components/Nav.jsx'
import { useAuth } from '../lib/AuthContext.jsx'

export default function Auth({ mode }) {
  const { user, store, signIn, signUp, isSupabase } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const signup = mode === 'signup'

  if (user) return <Navigate to={store ? '/painel' : '/comecar'} replace />

  async function onSubmit(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      if (signup) await signUp(form)
      else await signIn(form)
      navigate(signup ? '/comecar' : '/painel')
    } catch (err) {
      setError(err.message || 'Não foi possível entrar.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Nav />
      <main className="wrap" style={{ padding: '40px 0', maxWidth: 460 }}>
        <div className="card pad stack">
          <h2>{signup ? 'Criar vitrine grátis' : 'Entrar'}</h2>
          <p>{signup ? 'Sem cartão. Você cola o link na bio ainda hoje.' : 'Acesse o painel da sua loja.'}</p>
          {isSupabase ? (
            <p className="help">Para gravar a loja, a conta precisa estar logada. Se o cadastro pedir e-mail, confirme e entre.</p>
          ) : (
            <p className="help">Modo local: os dados ficam neste navegador até você conectar o Supabase.</p>
          )}
          <form className="form" onSubmit={onSubmit}>
            {signup && (
              <>
                <label>Seu nome</label>
                <input
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Ana"
                />
              </>
            )}
            <label>E-mail</label>
            <input
              required
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="ana@loja.com"
            />
            <label>Senha</label>
            <input
              required
              minLength={6}
              type="password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
            {error && <div className="error">{error}</div>}
            <button className="btn btn-dark" disabled={busy}>
              {busy ? 'Aguarde...' : signup ? 'Criar conta' : 'Entrar'}
            </button>
          </form>
          <p className="tiny">
            {signup ? (
              <>Já tem conta? <Link to="/entrar">Entrar</Link></>
            ) : (
              <>Nova por aqui? <Link to="/criar">Criar grátis</Link></>
            )}
          </p>
        </div>
      </main>
    </>
  )
}
