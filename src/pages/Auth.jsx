import React, { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import Nav from '../components/Nav.jsx'
import { useAuth } from '../lib/AuthContext.jsx'
import { isSupabase, supabase } from '../lib/supabase.js'

export default function Auth({ mode }) {
  const { user, store, signIn, signUp, isSupabase, recovering, clearRecovery, updatePassword } = useAuth()
  const navigate = useNavigate()
  const signup = mode === 'signup'
  const [view, setView] = useState(signup ? 'signup' : recovering ? 'recover' : 'login')
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' })
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')
  const [busy, setBusy] = useState(false)

  if (user) return <Navigate to={store ? '/painel' : '/comecar'} replace />

  useEffect(() => {
    if (recovering) {
      setView('recover')
      return
    }
    if (!isSupabase) return
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const query = new URLSearchParams(window.location.search)
    if (hash.get('type') === 'recovery' || query.get('type') === 'recovery') {
      setView('recover')
    }
  }, [recovering, isSupabase, signup])

  async function onSubmit(e) {
    e.preventDefault()
    setError('')
    setOk('')
    setBusy(true)
    try {
      if (view === 'signup') {
        await signUp(form)
        navigate('/comecar')
        return
      }
      if (view === 'forgot') {
        const redirectTo = `${window.location.origin}${import.meta.env.BASE_URL}entrar`
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(form.email, { redirectTo })
        if (resetError) throw resetError
        setOk('Enviamos um link para redefinir a senha. Confira seu e-mail.')
        return
      }
      if (view === 'recover') {
        if (form.password.length < 6) throw new Error('A senha precisa de pelo menos 6 caracteres.')
        if (form.password !== form.confirm) throw new Error('As senhas não conferem.')
        await updatePassword(form.password)
        setOk('Senha atualizada.')
        navigate('/painel')
        return
      }
      await signIn(form)
      navigate('/painel')
    } catch (err) {
      setError(err.message || 'Não foi possível concluir.')
    } finally {
      setBusy(false)
    }
  }

  const title = view === 'signup' ? 'Criar vitrine grátis' : view === 'forgot' ? 'Recuperar senha' : view === 'recover' ? 'Definir nova senha' : 'Entrar'
  const subtitle =
    view === 'signup'
      ? 'Sem cartão. Você cola o link na bio ainda hoje.'
      : view === 'forgot'
        ? 'Digite seu e-mail e enviaremos um link de redefinição.'
        : view === 'recover'
          ? 'Escolha a nova senha do seu painel.'
          : 'Acesse o painel da sua loja.'

  return (
    <>
      <Nav />
      <main className="wrap" style={{ padding: '40px 0', maxWidth: 460 }}>
        <div className="card pad stack">
          <h2>{title}</h2>
          <p>{subtitle}</p>
          {isSupabase ? (
            <p className="help">Para gravar a loja, a conta precisa estar logada. Se o cadastro pedir e-mail, confirme e entre.</p>
          ) : (
            <p className="help">Modo local: os dados ficam neste navegador até você conectar o Supabase.</p>
          )}
          <form className="form" onSubmit={onSubmit}>
            {view === 'signup' && (
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
            {view !== 'recover' && (
              <>
                <label>E-mail</label>
                <input
                  required
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="ana@loja.com"
                />
              </>
            )}
            {view !== 'forgot' && view !== 'recover' && (
              <>
                <label>Senha</label>
                <input
                  required
                  minLength={6}
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
              </>
            )}
            {view === 'recover' && (
              <>
                <label>Nova senha</label>
                <input
                  required
                  minLength={6}
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                />
                <label>Confirmar nova senha</label>
                <input
                  required
                  minLength={6}
                  type="password"
                  value={form.confirm}
                  onChange={(e) => setForm({ ...form, confirm: e.target.value })}
                />
              </>
            )}
            {error && <div className="error">{error}</div>}
            {ok && <div className="ok">{ok}</div>}
            <button className="btn btn-dark" disabled={busy}>
              {busy ? 'Aguarde...' : view === 'signup' ? 'Criar conta' : view === 'forgot' ? 'Enviar link' : view === 'recover' ? 'Salvar nova senha' : 'Entrar'}
            </button>
          </form>
          <p className="tiny">
            {view === 'signup' ? (
              <Link to="/entrar">Já tem conta? Entrar</Link>
            ) : view === 'forgot' ? (
              <a href="#" onClick={(e) => { e.preventDefault(); setView('login') }}>Voltar para o login</a>
            ) : view === 'recover' ? (
              <a href="#" onClick={(e) => { e.preventDefault(); clearRecovery(); setView('login') }}>Voltar para o login</a>
            ) : (
              <>
                <Link to="/criar">Nova por aqui? Criar grátis</Link>
                {isSupabase && (
                  <>
                    {' · '}
                    <a href="#" onClick={(e) => { e.preventDefault(); setView('forgot') }}>Esqueci a senha</a>
                  </>
                )}
              </>
            )}
          </p>
        </div>
      </main>
    </>
  )
}
