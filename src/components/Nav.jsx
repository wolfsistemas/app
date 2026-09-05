import React from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext.jsx'

export default function Nav() {
  const { user, store } = useAuth()
  return (
    <header className="nav">
      <div className="wrap between" style={{ padding: '12px 0' }}>
        <Link to="/" className="brand">
          <span className="logo">V</span>
          VitrineZap
        </Link>
        <div className="row">
          <a className="hide-sm" href={`${import.meta.env.BASE_URL}#preco`}>Preço</a>
          {user ? (
            <Link className="btn btn-dark" to={store ? '/painel' : '/comecar'}>
              Painel
            </Link>
          ) : (
            <>
              <Link className="btn btn-ghost" to="/entrar">Entrar</Link>
              <Link className="btn btn-dark" to="/criar">Criar grátis</Link>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
