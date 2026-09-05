import React, { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { localDb } from '../lib/local.js'
import { isSupabase, supabase } from '../lib/supabase.js'
import { money, uid } from '../lib/format.js'
import { buildOrderMessage, openWhatsApp } from '../lib/whatsapp.js'

export default function PublicStore() {
  const { slug } = useParams()
  const [store, setStore] = useState(null)
  const [products, setProducts] = useState([])
  const [cart, setCart] = useState([])
  const [category, setCategory] = useState('todos')
  const [checkout, setCheckout] = useState(false)
  const [customer, setCustomer] = useState({ name: '', note: '' })
  const [copied, setCopied] = useState('')
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      if (isSupabase) {
        const { data: storeRow } = await supabase.from('stores').select('*').eq('slug', slug).maybeSingle()
        if (!alive) return
        if (!storeRow) {
          setMissing(true)
          return
        }
        const { data: productRows } = await supabase
          .from('products')
          .select('*')
          .eq('store_id', storeRow.id)
          .eq('active', true)
          .order('sort')
        setStore(storeRow)
        setProducts(productRows || [])
        return
      }
      const local = localDb.storeBySlug(slug)
      if (!local) {
        setMissing(true)
        return
      }
      setStore(local)
      setProducts(localDb.productsByStore(local.id).filter((p) => p.active !== false))
    })()
    return () => {
      alive = false
    }
  }, [slug])

  const cats = useMemo(() => ['todos', ...new Set(products.map((p) => p.category || 'Geral'))], [products])
  const visible = products.filter((p) => category === 'todos' || p.category === category)
  const total = cart.reduce((s, i) => s + Number(i.price) * i.qty, 0)
  const count = cart.reduce((s, i) => s + i.qty, 0)

  function add(product) {
    setCart((prev) => {
      const found = prev.find((i) => i.id === product.id)
      if (found) return prev.map((i) => (i.id === product.id ? { ...i, qty: i.qty + 1 } : i))
      return [...prev, { id: product.id, name: product.name, price: product.price, qty: 1 }]
    })
  }

  function dec(id) {
    setCart((prev) =>
      prev
        .map((i) => (i.id === id ? { ...i, qty: i.qty - 1 } : i))
        .filter((i) => i.qty > 0)
    )
  }

  async function sendOrder() {
    const order = {
      store_id: store.id,
      customer_name: customer.name,
      items: cart.map(({ name, qty, price }) => ({ name, qty, price })),
      note: customer.note,
      total,
      status: 'novo',
      created_at: new Date().toISOString()
    }
    if (isSupabase) {
      await supabase.from('orders').insert(order)
    } else {
      localDb.saveOrder({ ...order, id: uid('order') })
    }
    const text = buildOrderMessage({
      store,
      items: cart,
      customerName: customer.name,
      note: customer.note,
      pixKey: store.plan === 'pro' ? store.pix_key : ''
    })
    openWhatsApp(store.whatsapp, text)
    setCheckout(false)
    setCart([])
  }

  async function copyPix() {
    if (!store.pix_key) return
    await navigator.clipboard.writeText(store.pix_key)
    setCopied('Chave PIX copiada')
    setTimeout(() => setCopied(''), 1800)
  }

  if (missing) {
    return (
      <main className="wrap center" style={{ padding: 48 }}>
        <h2>Loja não encontrada</h2>
        <p>Esse link ainda não existe.</p>
        <Link className="btn btn-dark" to="/criar">Criar minha vitrine</Link>
      </main>
    )
  }

  if (!store) return <main className="wrap" style={{ padding: 48 }}>Abrindo vitrine...</main>

  const cover = store.cover_url || 'https://images.unsplash.com/photo-1490481651871-ab68de25d43d?auto=format&fit=crop&w=1400&q=80'

  return (
    <div className={`theme-${store.theme || 'bosque'}`}>
      <header className="store-hero" style={{ background: `linear-gradient(180deg, rgba(0,0,0,.25), rgba(0,0,0,.62)), url(${cover}) center/cover` }}>
        <div className="wrap stack">
          {store.avatar_url ? (
            <img className="avatar" src={store.avatar_url} alt="" />
          ) : (
            <div className="avatar">{store.name.slice(0, 1)}</div>
          )}
          <div>
            <h1 style={{ fontSize: 36 }}>{store.name}</h1>
            <p style={{ color: '#f3eee4' }}>{store.bio}</p>
          </div>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {(store.links || []).map((link) => (
              <a key={link.id} className="btn btn-ghost" style={{ background: 'rgba(255,255,255,.16)', color: '#fff', borderColor: 'transparent' }} href={link.url} target="_blank" rel="noreferrer">
                {link.label}
              </a>
            ))}
            {store.instagram && (
              <a className="btn btn-ghost" style={{ background: 'rgba(255,255,255,.16)', color: '#fff', borderColor: 'transparent' }} href={`https://instagram.com/${store.instagram}`} target="_blank" rel="noreferrer">
                Instagram
              </a>
            )}
            {store.plan === 'pro' && store.pix_key && (
              <button className="btn btn-gold" onClick={copyPix}>PIX {store.pix_key}</button>
            )}
          </div>
          {copied && <span className="badge">{copied}</span>}
        </div>
      </header>

      <main className="wrap" style={{ padding: '18px 0 90px' }}>
        <div className="row" style={{ overflowX: 'auto', paddingBottom: 8 }}>
          {cats.map((c) => (
            <button key={c} className={`btn ${category === c ? 'btn-dark' : 'btn-ghost'}`} onClick={() => setCategory(c)}>
              {c}
            </button>
          ))}
        </div>
        <div className="grid-3" style={{ marginTop: 12 }}>
          {visible.map((p) => (
            <article className="card product-card" key={p.id}>
              {p.photo_url ? <img src={p.photo_url} alt={p.name} /> : <div style={{ height: 180, background: '#eee' }} />}
              <div className="pad stack">
                <strong>{p.name}</strong>
                {p.description && <p className="tiny">{p.description}</p>}
                <div className="row">
                  <span className="price">{money(p.price)}</span>
                  {Number(p.compare_at) > 0 && <span className="old">{money(p.compare_at)}</span>}
                </div>
                <button className="btn btn-dark" onClick={() => add(p)}>Adicionar</button>
              </div>
            </article>
          ))}
        </div>
        {store.plan !== 'pro' && (
          <p className="center tiny muted" style={{ marginTop: 28 }}>
            Feito com <Link to="/">VitrineZap</Link>
          </p>
        )}
      </main>

      {count > 0 && !checkout && (
        <button className="cartbar" onClick={() => setCheckout(true)}>
          <span>{count} {count === 1 ? 'item' : 'itens'}</span>
          <strong>Pedir {money(total)}</strong>
        </button>
      )}

      {checkout && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(10,20,16,.45)', display: 'grid', placeItems: 'end center', padding: 12 }}>
          <div className="card pad stack" style={{ width: 'min(520px, 100%)' }}>
            <div className="between">
              <h3>Fechar pedido</h3>
              <button className="btn btn-ghost" onClick={() => setCheckout(false)}>Fechar</button>
            </div>
            {cart.map((i) => (
              <div className="between" key={i.id}>
                <span>{i.qty}x {i.name}</span>
                <div className="row">
                  <span>{money(i.price * i.qty)}</span>
                  <button className="btn btn-ghost" onClick={() => dec(i.id)}>-</button>
                  <button className="btn btn-ghost" onClick={() => add(i)}>+</button>
                </div>
              </div>
            ))}
            <strong>Total {money(total)}</strong>
            <input placeholder="Seu nome" value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} />
            <textarea placeholder="Observação (tamanho, entrega...)" value={customer.note} onChange={(e) => setCustomer({ ...customer, note: e.target.value })} />
            {store.plan === 'pro' && store.pix_key && <p className="help">A chave PIX vai junto no texto do WhatsApp.</p>}
            <button className="btn btn-whats" onClick={sendOrder}>Enviar no WhatsApp</button>
          </div>
        </div>
      )}
    </div>
  )
}
