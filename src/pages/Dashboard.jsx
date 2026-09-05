import React, { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext.jsx'
import PhotoInput from '../components/PhotoInput.jsx'
import { FREE_PRODUCT_LIMIT, formatPhone, money, onlyDigits, publicUrl, slugify, timeAgo, uid } from '../lib/format.js'

const TABS = [
  ['vitrine', 'Vitrine'],
  ['produtos', 'Produtos'],
  ['pedidos', 'Pedidos'],
  ['links', 'Bio / links'],
  ['plano', 'Plano']
]

export default function Dashboard() {
  const { user, store, products, orders, saveStore, saveProduct, deleteProduct, updateOrder, signOut } = useAuth()
  const [tab, setTab] = useState('produtos')
  const [form, setForm] = useState(store)
  const [product, setProduct] = useState(null)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const url = publicUrl(store.slug)
  const isPro = store.plan === 'pro'
  const limitHit = !isPro && products.length >= FREE_PRODUCT_LIMIT

  const stats = useMemo(() => {
    const total = orders.reduce((s, o) => s + Number(o.total || 0), 0)
    const novos = orders.filter((o) => o.status === 'novo').length
    return { total, novos, count: orders.length }
  }, [orders])

  async function persistStore(next) {
    setError('')
    try {
      const saved = await saveStore({
        ...store,
        ...next,
        whatsapp: onlyDigits(next.whatsapp ?? store.whatsapp)
      })
      setForm(saved)
      setMsg('Salvo.')
    } catch (err) {
      setError(err.message)
    }
  }

  async function onSaveProduct(e) {
    e.preventDefault()
    setError('')
    if (limitHit && !product.id) {
      setError(`Plano grátis: máximo ${FREE_PRODUCT_LIMIT} produtos.`)
      return
    }
    try {
      await saveProduct({
        ...(product.id ? { id: product.id } : {}),
        store_id: store.id,
        name: product.name,
        description: product.description || '',
        price: Number(String(product.price).replace(',', '.')) || 0,
        compare_at: Number(String(product.compare_at || 0).replace(',', '.')) || 0,
        category: product.category || 'Geral',
        photo_url: product.photo_url || '',
        active: product.active !== false,
        sort: product.sort || products.length + 1
      })
      setProduct(null)
      setMsg('Produto salvo.')
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div>
      <header className="nav">
        <div className="wrap between" style={{ padding: '12px 0' }}>
          <Link to="/" className="brand">
            <span className="logo">V</span>
            {store.name}
          </Link>
          <div className="row">
            <a className="btn btn-ghost" href={url} target="_blank" rel="noreferrer">Ver loja</a>
            <button className="btn btn-ghost" onClick={signOut}>Sair</button>
          </div>
        </div>
      </header>

      <main className="wrap" style={{ padding: '24px 0 60px' }}>
        <div className="between">
          <div>
            <h2>Olá{user?.user_metadata?.name || user?.name ? `, ${user.user_metadata?.name || user.name}` : ''}</h2>
            <p className="muted">{url}</p>
          </div>
          <div className="row">
            <span className="chip">{isPro ? 'Plano Loja' : 'Plano grátis'}</span>
            <span className="chip">{stats.novos} pedidos novos</span>
          </div>
        </div>

        <div className="grid-3" style={{ margin: '18px 0' }}>
          <article className="card pad"><div className="tiny muted">Pedidos</div><h3>{stats.count}</h3></article>
          <article className="card pad"><div className="tiny muted">Volume</div><h3>{money(stats.total)}</h3></article>
          <article className="card pad"><div className="tiny muted">Produtos</div><h3>{products.length}{!isPro && ` / ${FREE_PRODUCT_LIMIT}`}</h3></article>
        </div>

        <div className="row" style={{ flexWrap: 'wrap', marginBottom: 16 }}>
          {TABS.map(([id, label]) => (
            <button key={id} className={`btn ${tab === id ? 'btn-dark' : 'btn-ghost'}`} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
        {msg && <div className="ok">{msg}</div>}
        {error && <div className="error">{error}</div>}

        {tab === 'vitrine' && (
          <section className="card pad stack">
            <h3>Dados da loja</h3>
            <div className="form">
              <label>Nome</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              <label>Link</label>
              <input value={form.slug} onChange={(e) => setForm({ ...form, slug: slugify(e.target.value) })} />
              <label>WhatsApp</label>
              <input value={formatPhone(form.whatsapp)} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} />
              <label>Chave PIX</label>
              <input value={form.pix_key || ''} onChange={(e) => setForm({ ...form, pix_key: e.target.value })} placeholder="aparece no pedido" />
              <label>Bio</label>
              <textarea value={form.bio || ''} onChange={(e) => setForm({ ...form, bio: e.target.value })} />
              <label>Tema</label>
              <select value={form.theme} onChange={(e) => setForm({ ...form, theme: e.target.value })}>
                <option value="bosque">Bosque</option>
                <option value="areia">Areia</option>
                <option value="rosa">Rosa</option>
                <option value="noite">Noite</option>
              </select>
              <PhotoInput
                label="Foto de capa"
                value={form.cover_url || ''}
                onChange={(url) => setForm({ ...form, cover_url: url })}
              />
              <PhotoInput
                label="Avatar"
                value={form.avatar_url || ''}
                onChange={(url) => setForm({ ...form, avatar_url: url })}
              />
              <button className="btn btn-dark" onClick={() => persistStore(form)}>Salvar vitrine</button>
            </div>
          </section>
        )}

        {tab === 'produtos' && (
          <section className="stack">
            <div className="between">
              <h3>Produtos</h3>
              <button className="btn btn-dark" disabled={limitHit && !product} onClick={() => setProduct({ name: '', price: '', category: 'Geral', description: '', photo_url: '', active: true })}>
                Novo produto
              </button>
            </div>
            {limitHit && <p className="help">Limite do plano grátis atingido. Passe para o plano Loja para continuar.</p>}
            {product && (
              <form className="card pad form" onSubmit={onSaveProduct}>
                <label>Nome</label>
                <input required value={product.name} onChange={(e) => setProduct({ ...product, name: e.target.value })} />
                <div className="grid-2">
                  <div>
                    <label>Preço</label>
                    <input required value={product.price} onChange={(e) => setProduct({ ...product, price: e.target.value })} />
                  </div>
                  <div>
                    <label>De (opcional)</label>
                    <input value={product.compare_at || ''} onChange={(e) => setProduct({ ...product, compare_at: e.target.value })} />
                  </div>
                </div>
                <label>Categoria</label>
                <input value={product.category || ''} onChange={(e) => setProduct({ ...product, category: e.target.value })} />
                <PhotoInput
                  label="Foto"
                  value={product.photo_url || ''}
                  onChange={(url) => setProduct({ ...product, photo_url: url })}
                />
                <label>Descrição</label>
                <textarea value={product.description || ''} onChange={(e) => setProduct({ ...product, description: e.target.value })} />
                <div className="row">
                  <button className="btn btn-dark">Salvar</button>
                  <button type="button" className="btn btn-ghost" onClick={() => setProduct(null)}>Cancelar</button>
                </div>
              </form>
            )}
            <div className="grid-3">
              {products.map((p) => (
                <article className="card product-card" key={p.id}>
                  {p.photo_url ? <img src={p.photo_url} alt="" /> : <div style={{ height: 120, background: '#eee' }} />}
                  <div className="pad">
                    <strong>{p.name}</strong>
                    <div className="row">
                      <span className="price">{money(p.price)}</span>
                      {Number(p.compare_at) > 0 && <span className="old">{money(p.compare_at)}</span>}
                    </div>
                    <div className="row" style={{ marginTop: 10 }}>
                      <button className="btn btn-ghost" onClick={() => setProduct(p)}>Editar</button>
                      <button className="btn btn-rose" onClick={() => deleteProduct(p.id)}>Apagar</button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {tab === 'pedidos' && (
          <section className="card pad">
            <h3>Pedidos</h3>
            {orders.length === 0 && <p>Os pedidos da vitrine aparecem aqui.</p>}
            <table className="table">
              <thead>
                <tr><th>Quando</th><th>Cliente</th><th>Itens</th><th>Total</th><th></th></tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id}>
                    <td>{timeAgo(o.created_at)}</td>
                    <td>{o.customer_name || 'Cliente'}</td>
                    <td>{(o.items || []).map((i) => `${i.qty}x ${i.name}`).join(', ')}</td>
                    <td>{money(o.total)}</td>
                    <td>
                      <select value={o.status} onChange={(e) => updateOrder(o.id, { status: e.target.value })}>
                        <option value="novo">Novo</option>
                        <option value="atendido">Atendido</option>
                        <option value="cancelado">Cancelado</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {tab === 'links' && (
          <section className="card pad stack">
            <h3>Botões da bio</h3>
            <p>Aparecem acima da vitrine, no mesmo link.</p>
            {(form.links || []).map((link, idx) => (
              <div className="grid-2" key={link.id}>
                <input
                  value={link.label}
                  onChange={(e) => {
                    const links = [...form.links]
                    links[idx] = { ...link, label: e.target.value }
                    setForm({ ...form, links })
                  }}
                />
                <input
                  value={link.url}
                  onChange={(e) => {
                    const links = [...form.links]
                    links[idx] = { ...link, url: e.target.value }
                    setForm({ ...form, links })
                  }}
                />
              </div>
            ))}
            <div className="row">
              <button
                className="btn btn-ghost"
                onClick={() => setForm({ ...form, links: [...(form.links || []), { id: uid('link'), label: 'Novo link', url: 'https://' }] })}
              >
                Adicionar botão
              </button>
              <button className="btn btn-dark" onClick={() => persistStore(form)}>Salvar links</button>
            </div>
          </section>
        )}

        {tab === 'plano' && (
          <section className="grid-2">
            <article className="card pad stack">
              <h3>Grátis</h3>
              <p>Até {FREE_PRODUCT_LIMIT} produtos, com marca VitrineZap.</p>
              <span className="chip">{isPro ? 'Anterior' : 'Plano atual'}</span>
            </article>
            <article className="card pad stack">
              <h3>Loja · R$ 19,90/mês</h3>
              <p>Ilimitado, sem marca, PIX no pedido e temas.</p>
              {isPro ? (
                <span className="chip">Ativo</span>
              ) : (
                <button className="btn btn-gold" onClick={() => persistStore({ plan: 'pro' })}>
                  Ativar neste ambiente
                </button>
              )}
              <p className="help">
                Em produção, este botão vira checkout Mercado Pago / Stripe. O webhook (Supabase Edge ou GAS)
                marca a loja como pro.
              </p>
            </article>
          </section>
        )}
      </main>
    </div>
  )
}
