import React, { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { localDb } from '../lib/local.js'
import { isSupabase, supabase } from '../lib/supabase.js'
import { isProStore, money, uid } from '../lib/format.js'
import { buildOrderMessage, whatsappUrl } from '../lib/whatsapp.js'
import { createPix, notifyOrder } from '../lib/payments.js'
import { recentOrders, rememberOrder } from '../lib/recentOrders.js'
import Brand from '../components/Brand.jsx'
import PImg from '../components/PImg.jsx'
import { useToast } from '../components/Toast.jsx'

function setMeta(attr, key, content) {
  if (typeof document === 'undefined') return
  let el = document.head.querySelector(`meta[${attr}="${key}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content || '')
}

export default function PublicStore() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const showToast = useToast()
  const [store, setStore] = useState(null)
  const [products, setProducts] = useState([])
  const [cart, setCart] = useState([])
  const [category, setCategory] = useState('todos')
  const [zoom, setZoom] = useState('')
  const [checkout, setCheckout] = useState(false)
  const [customer, setCustomer] = useState({ name: '', phone: '', email: '', note: '' })
  const [missing, setMissing] = useState(false)
  const [sending, setSending] = useState(false)

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
  const recent = useMemo(() => recentOrders(slug), [slug])
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

  useEffect(() => {
    document.title = store
      ? `${store.name} · peça pelo WhatsApp`
      : 'VitrineZap'
    if (store) {
      const desc = (store.bio || `Faça seu pedido pelo WhatsApp em ${store.name}.`).slice(0, 200)
      const base = (import.meta.env.VITE_SITE_URL || window.location.origin).replace(/\/$/, '')
      const img = store.avatar_url || store.cover_url || products.find((p) => p.photo_url)?.photo_url || ''
      setMeta('name', 'description', desc)
      setMeta('property', 'og:type', 'website')
      setMeta('property', 'og:title', store.name)
      setMeta('property', 'og:description', desc)
      setMeta('property', 'og:url', `${base}/${slug}`)
      if (img) setMeta('property', 'og:image', img)
    }
    return () => {
      document.title = 'VitrineZap — catalogo no WhatsApp'
    }
  }, [store, products, slug])

  async function sendOrder() {
    if (!customer.name || sending) return
    setSending(true)
    let orderCode = ''
    let created = null
    const order = {
      store_id: store.id,
      customer_name: customer.name,
      customer_phone: customer.phone || '',
      customer_email: customer.email || '',
      items: cart.map(({ name, qty, price }) => ({ name, qty, price })),
      note: customer.note,
      total,
      status: 'novo',
      created_at: new Date().toISOString()
    }
    if (isSupabase) {
      try {
        const baseArgs = {
          p_store_id: order.store_id,
          p_customer_name: order.customer_name,
          p_customer_phone: order.customer_phone,
          p_items: order.items,
          p_note: order.note,
          p_total: order.total
        }
        let res = await supabase.rpc('create_order', { ...baseArgs, p_customer_email: order.customer_email })
        if (res.error) {
          // Banco sem up_order_notify.sql: tenta sem o e-mail.
          res = await supabase.rpc('create_order', baseArgs)
        }
        created = res.data || null
        orderCode = res.data?.code ? String(res.data.code) : ''
      } catch {
        // o WhatsApp é a fonte da verdade; pedido no banco é bônus
      }
    } else {
      localDb.saveOrder({ ...order, id: uid('order') })
    }

    // Pro com Mercado Pago conectado: cobra Pix na conta do vendedor e leva
    // o cliente para a página do pedido (confirmação automática).
    if (isSupabase && store.mp_connected) {
      if (!created?.id) {
        showToast('Não deu para registrar o pedido no banco. Enviando pelo WhatsApp.', 'info', 7000)
      } else if (!created.public_token) {
        console.error('public_token ausente no pedido — rode supabase/up_seller_payments.sql')
        showToast('Banco desatualizado (public_token). Rode a migração up_seller_payments.sql.', 'info', 8000)
      } else {
        try {
          rememberOrder({
            token: created.public_token,
            slug: store.slug,
            code: created.code || '',
            total,
            at: Date.now()
          })
          await createPix({ storeId: store.id, orderId: created.id, payerEmail: customer.email || '' })
          setCheckout(false)
          setCart([])
          setCustomer({ name: '', phone: '', email: '', note: '' })
          setSending(false)
          navigate(`/pedido/${created.public_token}`)
          return
        } catch (err) {
          console.error('create_pix falhou:', err)
          showToast(`Pix falhou: ${err?.message || 'erro desconhecido'}. Enviando pelo WhatsApp.`, 'info', 9000)
        }
      }
    }

    // Avisa o cliente por e-mail (link do pedido), quando informado.
    if (isSupabase && created?.id && customer.email) {
      notifyOrder({ storeId: store.id, orderId: created.id }).catch(() => {})
    }

    const text = buildOrderMessage({
      store,
      items: cart,
      customerName: customer.name,
      customerPhone: customer.phone,
      note: customer.note,
      pixKey: isProStore(store) ? store.pix_key : '',
      code: orderCode
    })
    const url = whatsappUrl(store.whatsapp, text)
    const win = window.open('', '_blank')
    if (win) {
      win.opener = null
      win.location = url
    } else {
      window.location.href = url
    }
    setCheckout(false)
    setCart([])
    setCustomer({ name: '', phone: '', email: '', note: '' })
    setSending(false)
  }

  async function copyPix() {
    if (!store.pix_key) return
    await navigator.clipboard.writeText(store.pix_key)
    showToast('Chave PIX copiada', 'ok')
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

  const cover = store.cover_url || ''
  const heroStyle = cover
    ? {
        background: `linear-gradient(180deg, rgba(0,0,0,.12), var(--veil)), url(${cover}) center/cover`
      }
    : {}

  const links = store.links || []
  const seen = new Set()
  const displayLinks = links.filter((l) => {
    const key = `${l.url || ''}|${(l.label || '').toLowerCase()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  const hasInstaLink = store.instagram
    ? displayLinks.some((l) => l.url && l.url.toLowerCase().includes(`instagram.com/${store.instagram.toLowerCase()}`))
    : true

  const isFree = !isProStore(store)

  return (
    <div className={`theme-${store.theme || 'bosque'}`}>
      {isFree && (
        <div className="freebar">
          <Brand onDark />
          <div className="row">
            <span className="hide-sm">Vitrine grátis — nossa marca aparece para o cliente.</span>
            <Link className="cta" to="/criar">Criar a minha grátis</Link>
          </div>
        </div>
      )}
      <header className="store-hero" style={heroStyle}>
        <div className="wrap stack">
          {store.avatar_url ? (
            <PImg className="avatar" src={store.avatar_url} alt="" />
          ) : (
            <div className="avatar">{store.name.slice(0, 1)}</div>
          )}
          <div>
            <h1 style={{ fontSize: 36 }}>{store.name}</h1>
            <p style={{ color: '#f3eee4' }}>{store.bio}</p>
          </div>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            {displayLinks.map((link) => (
              <a key={link.id} className="btn btn-ghost" style={{ background: 'rgba(255,255,255,.16)', color: '#fff', borderColor: 'transparent' }} href={link.url} target="_blank" rel="noreferrer">
                {link.label}
              </a>
            ))}
            {store.instagram && !hasInstaLink && (
              <a className="btn btn-ghost" style={{ background: 'rgba(255,255,255,.16)', color: '#fff', borderColor: 'transparent' }} href={`https://instagram.com/${store.instagram}`} target="_blank" rel="noreferrer">
                Instagram
              </a>
            )}
            {store.plan === 'pro' && isProStore(store) && store.pix_key && (
              <button className="btn btn-gold" onClick={copyPix}>PIX {store.pix_key}</button>
            )}
          </div>
        </div>
      </header>

      <main className="wrap" style={{ padding: '18px 0 90px' }}>
        <div className="row" style={{ overflowX: 'auto', paddingBottom: 8 }}>
          {cats.map((c) => (
            <button key={c} className={`btn ${category === c ? 'btn-theme' : 'btn-ghost'}`} onClick={() => setCategory(c)}>
              {c}
            </button>
          ))}
        </div>
        <div className="grid-3" style={{ marginTop: 12 }}>
          {visible.map((p) => (
            <article className="card product-card" key={p.id}>
              {p.photo_url ? <PImg className="product-img zoomable" src={p.photo_url} alt={p.name} onClick={() => setZoom(p.photo_url)} /> : <div className="product-img" />}
              <div className="pad stack">
                <strong>{p.name}</strong>
                {p.description && <p className="tiny">{p.description}</p>}
                <div className="row">
                  <span className="price">{money(p.price)}</span>
                  {Number(p.compare_at) > 0 && <span className="old">{money(p.compare_at)}</span>}
                </div>
                <button className="btn btn-theme" onClick={() => add(p)}>Adicionar</button>
              </div>
            </article>
          ))}
        </div>
        {recent.length > 0 && (
          <section className="card pad stack" style={{ marginTop: 18 }}>
            <strong>Seus pedidos recentes</strong>
            {recent.slice(0, 3).map((o) => (
              <Link className="between" key={o.token} to={`/pedido/${o.token}`}>
                <span>Pedido {o.code ? `nº ${String(o.code).padStart(3, '0')}` : ''}</span>
                <span className="muted">{o.total ? money(o.total) : ''}</span>
              </Link>
            ))}
          </section>
        )}
        {isFree && (
          <p className="center tiny" style={{ marginTop: 28 }}>
            <Link to="/criar" className="muted">Criado com VitrineZap — remova a nossa marca no Plano Loja.</Link>
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
            <input placeholder="Seu nome" required value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} />
            <input placeholder="Seu WhatsApp (opcional)" value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} />
            <input type="email" placeholder="Seu e-mail (opcional, para acompanhar)" value={customer.email} onChange={(e) => setCustomer({ ...customer, email: e.target.value })} />
            <textarea placeholder="Observação (tamanho, entrega...)" value={customer.note} onChange={(e) => setCustomer({ ...customer, note: e.target.value })} />
            {store.mp_connected ? (
              <p className="help">Você vai pagar com Pix e o pedido é confirmado automaticamente.</p>
            ) : (
              isProStore(store) && store.pix_key && <p className="help">A chave PIX vai junto no texto do WhatsApp.</p>
            )}
            <button className="btn btn-whats" disabled={!customer.name || sending} onClick={sendOrder}>
              {sending ? 'Enviando...' : store.mp_connected ? 'Gerar Pix e confirmar' : 'Enviar no WhatsApp'}
            </button>
          </div>
        </div>
      )}

      {zoom && (
        <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) setZoom('') }}>
          <div className="card pad stack modal" onMouseDown={(e) => e.stopPropagation()} style={{ width: 'min(720px, 100%)' }}>
            <div className="between">
              <h3>Foto do produto</h3>
              <button type="button" className="modal-x" aria-label="Fechar" onClick={() => setZoom('')}>×</button>
            </div>
            <PImg className="zoom-img" src={zoom} alt="" />
          </div>
        </div>
      )}
    </div>
  )
}
