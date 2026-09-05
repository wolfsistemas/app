import React from 'react'
import { Link } from 'react-router-dom'
import Nav from '../components/Nav.jsx'
import { money } from '../lib/format.js'
import { DEMO_PRODUCTS, DEMO_STORE } from '../lib/seed.js'

export default function Landing() {
  return (
    <>
      <Nav />
      <main>
        <section className="hero">
          <div className="wrap grid-2" style={{ alignItems: 'center' }}>
            <div className="stack">
              <span className="kicker">Bio link + catálogo + pedido no WhatsApp</span>
              <h1>Seu Instagram vira loja. O pedido cai pronto no zap.</h1>
              <p className="lead">
                Pare de mandar tabela, print e “preços no direct”. Monte a vitrine, cole o link na bio
                e receba o pedido formatado no WhatsApp — com nome, peças e total.
              </p>
              <div className="row">
                <Link className="btn btn-dark" to="/criar">Criar minha vitrine grátis</Link>
                <Link className="btn btn-ghost" to="/ana-atelier">Ver demo</Link>
              </div>
              <p className="tiny muted">Grátis até 15 produtos. Sem cartão. No ar em 3 minutos.</p>
            </div>
            <div className="phone">
              <div className="phone-screen">
                <div className="phone-top">
                  <span className="badge">ana-atelier</span>
                  <h3 style={{ marginTop: 8 }}>{DEMO_STORE.name}</h3>
                  <p style={{ color: '#e9f4ec', margin: '6px 0 0' }}>{DEMO_STORE.bio}</p>
                </div>
                <div className="pad stack">
                  {DEMO_PRODUCTS.slice(0, 3).map((p) => (
                    <div key={p.id} className="between" style={{ background: '#fff', borderRadius: 16, padding: 8, border: '1px solid var(--line)' }}>
                      <div className="row">
                        <img src={p.photo_url} alt="" style={{ width: 52, height: 52, objectFit: 'cover', borderRadius: 12 }} />
                        <div>
                          <strong>{p.name}</strong>
                          <div className="tiny muted">{p.category}</div>
                        </div>
                      </div>
                      <span className="price">{money(p.price)}</span>
                    </div>
                  ))}
                  <button className="btn btn-whats">Pedir no WhatsApp · R$ 318,80</button>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="wrap" style={{ padding: '20px 0 50px' }}>
          <div className="grid-3">
            {[
              ['1. Sobe as fotos', 'Nome, preço e WhatsApp. Sem estoque complicado, sem app para o cliente baixar.'],
              ['2. Cola o link na bio', 'Um link só: botões, vitrine e PIX. Substitui Linktree + tabela do zap.'],
              ['3. Recebe o pedido pronto', 'O cliente escolhe, você recebe no WhatsApp com total e observação.']
            ].map(([t, d]) => (
              <article className="card pad" key={t}>
                <h3>{t}</h3>
                <p>{d}</p>
              </article>
            ))}
          </div>
        </section>

        <section id="preco" className="wrap" style={{ paddingBottom: 60 }}>
          <h2>Preço de embalagem, não de agência</h2>
          <p>Começa grátis. Paga quando a vitrine já estiver vendendo.</p>
          <div className="grid-2" style={{ marginTop: 18 }}>
            <article className="card pad stack">
              <span className="chip">Grátis</span>
              <h3>R$ 0</h3>
              <p>Bio link + até 15 produtos. Ideal para testar com a loja real.</p>
              <ul className="muted">
                <li>Link na bio com vitrine</li>
                <li>Pedido no WhatsApp</li>
                <li>Marca VitrineZap no rodapé</li>
              </ul>
              <Link className="btn btn-ghost" to="/criar">Começar grátis</Link>
            </article>
            <article className="card pad stack" style={{ borderColor: '#c9a227' }}>
              <span className="chip">Loja</span>
              <h3>R$ 19,90 / mês</h3>
              <p>Ilimitado, sem nossa marca, PIX no pedido e temas da loja.</p>
              <ul className="muted">
                <li>Produtos ilimitados</li>
                <li>Remove a marca</li>
                <li>Chave PIX no pedido</li>
                <li>Pedidos organizados no painel</li>
              </ul>
              <Link className="btn btn-gold" to="/criar">Quero vender com isso</Link>
            </article>
          </div>
        </section>
      </main>
      <footer className="footer">
        <div className="wrap between">
          <span>VitrineZap · catálogo + bio link para quem vende no WhatsApp</span>
          <span className="tiny">Hospedado no GitHub · dados no Supabase</span>
        </div>
      </footer>
    </>
  )
}
