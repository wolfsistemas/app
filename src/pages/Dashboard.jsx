import React, { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext.jsx'
import { isSupabase, supabase } from '../lib/supabase.js'
import Brand from '../components/Brand.jsx'
import PhotoInput from '../components/PhotoInput.jsx'
import PImg from '../components/PImg.jsx'
import { useToast } from '../components/Toast.jsx'
import { cancelSubscription, createCheckout, createSubscription, syncSubscription, billingUrl, mpBillingAvailable } from '../lib/billing.js'
import { FREE_PRODUCT_LIMIT, formatPhone, isProStore, money, onlyDigits, PLAN_PRICE, planExpiresAt, publicUrl, slugify, timeAgo, uid } from '../lib/format.js'

function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45)
    osc.start()
    osc.stop(ctx.currentTime + 0.5)
    osc.onended = () => ctx.close()
  } catch {
    // sem áudio disponível
  }
}

const TABS = [
  ['vitrine', 'Vitrine'],
  ['produtos', 'Produtos'],
  ['pedidos', 'Pedidos'],
  ['links', 'Bio / links'],
  ['plano', 'Plano']
]

export default function Dashboard() {
  const { user, store, products, orders, saveStore, saveProduct, deleteProduct, updateOrder, addOrder, applyOrderPatch, signOut, refresh } = useAuth()
  const [tab, setTab] = useState('produtos')
  const [form, setForm] = useState(store)
  const [product, setProduct] = useState(null)
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [copiedLink, setCopiedLink] = useState(false)
  const showToast = useToast()
  const [billingBusy, setBillingBusy] = useState(false)
  const [subBusy, setSubBusy] = useState(false)
  const [mpSubAvailable, setMpSubAvailable] = useState(false)
  const url = publicUrl(store.slug)
  const isPro = isProStore(store)
  const planEnd = planExpiresAt(store)
  const limitHit = !isPro && products.length >= FREE_PRODUCT_LIMIT
  const subActive = isPro && store.mp_subscription_status === 'authorized'
  const { id: storeId } = store
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    if (!billingUrl) return undefined
    let dead = false
    mpBillingAvailable().then((ok) => {
      if (!dead) setMpSubAvailable(ok)
    })
    return () => { dead = true }
  }, [])

  useEffect(() => {
    const q = new URLSearchParams(location.search)
    if (q.get('plano') === 'ok') {
      navigate('/painel', { replace: true })
      setMsg('Pagamento confirmado! Ativando seu plano...')
      // Ativação imediata via GAS (busca a assinatura na API do MP), sem esperar
      // o webhook. Repete algumas vezes cobrindo atraso do MP em processar.
      let tentativas = 0
      const run = () => {
        tentativas += 1
        syncSubscription({ storeId }).then((r) => {
          if (r && (r.ok || r.status === 'already-active')) refresh()
          else if (tentativas < 4) setTimeout(run, 4000)
        }).catch(() => {
          if (tentativas < 4) setTimeout(run, 4000)
        })
      }
      run()
      const t1 = setTimeout(() => { refresh() }, 9000)
      const t2 = setTimeout(() => { refresh() }, 18000)
      return () => {
        clearTimeout(t1)
        clearTimeout(t2)
      }
    }
    return undefined
  }, [location.search])

  useEffect(() => {
    if (!isSupabase || !storeId) return undefined
    const channel = supabase
      .channel(`orders-${storeId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'orders',
        filter: `store_id=eq.${storeId}`
      }, (payload) => {
        const row = payload.new
        if (!row) return
        addOrder(row)
        beep()
        const code = String(row.code || '').padStart(3, '0')
        showToast(`Pedido nº ${code} · ${row.customer_name || 'Cliente'} · ${money(row.total)}`, 'info', 7000)
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'orders',
        filter: `store_id=eq.${storeId}`
      }, (payload) => {
        applyOrderPatch(payload.new.id, payload.new)
      })
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [storeId])

  async function upgrade() {
    setError('')
    setBillingBusy(true)
    try {
      const link = await createCheckout({
        storeId,
        email: user?.email || '',
        name: user?.user_metadata?.name || ''
      })
      window.location.href = link
    } catch (err) {
      setError(err.message || 'Não foi possível abrir o pagamento.')
    } finally {
      setBillingBusy(false)
    }
  }

  async function subscribe() {
    setError('')
    setBillingBusy(true)
    try {
      const url = await createSubscription({ storeId })
      window.location.href = url
    } catch (err) {
      setError(err.message || 'Não foi possível gerar o link de assinatura.')
    } finally {
      setBillingBusy(false)
    }
  }

  async function checkSubscription() {
    setError('')
    setBillingBusy(true)
    try {
      const r = await syncSubscription({ storeId })
      if (r && (r.ok || r.status === 'already-active')) {
        setMsg(r.status === 'already-active' ? 'Plano já está ativo.' : 'Assinatura confirmada! Plano ativado.')
        await refresh()
      } else {
        setError((r && r.error) || 'Nenhuma assinatura ativa encontrada ainda. Tente de novo em instantes.')
      }
    } catch (err) {
      setError(err.message || 'Falha ao verificar assinatura.')
    } finally {
      setBillingBusy(false)
    }
  }

  async function cancelSub() {
    if (!window.confirm('Cancelar a assinatura recorrente? Você mantém o Plano Loja até a data já paga e depois volta ao grátis.')) return
    setError('')
    setSubBusy(true)
    try {
      await cancelSubscription({ storeId })
      await refresh()
      setMsg('Assinatura cancelada. Acesso garantido até a data já paga.')
    } catch (err) {
      setError(err.message || 'Não foi possível cancelar a assinatura.')
    } finally {
      setSubBusy(false)
    }
  }

  async function demoActivate() {
    setError('')
    try {
      await saveStore({ plan: 'pro' })
      setMsg('Plano ativado neste ambiente para testes.')
    } catch (err) {
      setError(err.message || 'Falha ao ativar.')
    }
  }

  const stats = useMemo(() => {
    const total = orders.reduce((s, o) => s + Number(o.total || 0), 0)
    const novos = orders.filter((o) => o.status === 'novo').length
    return { total, novos, count: orders.length }
  }, [orders])

  async function persistStore(next, okLabel = 'Dados salvos') {
    setError('')
    try {
      const saved = await saveStore({
        ...store,
        ...next,
        whatsapp: onlyDigits(next.whatsapp ?? store.whatsapp)
      })
      setForm(saved)
      showToast(okLabel, 'ok')
    } catch (err) {
      setError(err.message)
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      const el = document.createElement('textarea')
      el.value = url
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
    }
    setCopiedLink(true)
    setMsg('')
    setTimeout(() => setCopiedLink(false), 2000)
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
      showToast('Produto salvo', 'ok')
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div>
      <header className="nav">
        <div className="wrap between" style={{ padding: '12px 0' }}>
          <Brand />
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
            <p className="muted">{store.name}</p>
          </div>
          <div className="row">
            <span className={`chip ${isPro ? '' : 'chip-gold'}`}>
              {isPro ? 'Plano Loja' : 'Plano grátis'}
              {isPro && planEnd ? ` · até ${planEnd.toLocaleDateString('pt-BR')}` : ''}
            </span>
            {!isPro && store.plan === 'pro' && <span className="chip chip-rose">Expirado</span>}
            <span className="chip">{stats.novos} pedidos novos</span>
          </div>
        </div>

        <section className="card pad copybox" style={{ margin: '18px 0' }}>
          <input readOnly value={url} onFocus={(e) => e.target.select()} />
          <button className={copiedLink ? 'btn btn-gold' : 'btn btn-dark'} onClick={copyLink}>
            {copiedLink ? 'Copiado!' : 'Copiar link'}
          </button>
        </section>

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
              <button className="btn btn-dark" onClick={() => persistStore(form, 'Vitrine salva')}>Salvar vitrine</button>
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
            {limitHit && (
              <div className="card pad between" style={{ borderColor: '#c9a227', marginBottom: 12 }}>
                <div>
                  <strong>Você chegou ao limite do plano grátis ({FREE_PRODUCT_LIMIT} produtos).</strong>
                  <div className="help">Assine o Plano Loja para cadastrar mais de {FREE_PRODUCT_LIMIT} e remover a marca VitrineZap da vitrine.</div>
                </div>
                <button className="btn btn-gold" onClick={() => setTab('plano')}>Ver plano</button>
              </div>
            )}
            {product && (
              <form className="card pad form" onSubmit={onSaveProduct}>
                {product.id && (
                  <p className="help">Você está editando um produto existente.</p>
                )}
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
            {products.length === 0 && !product ? (
              <div className="card pad center stack" style={{ marginTop: 12, textAlign: 'center' }}>
                <h3>Nenhum produto ainda</h3>
                <p className="muted">Cadastre seu primeiro produto para montar a vitrine.</p>
                <div className="row" style={{ justifyContent: 'center' }}>
                  <button className="btn btn-dark" onClick={() => setProduct({ name: '', price: '', category: 'Geral', description: '', photo_url: '', active: true })}>
                    Cadastrar produto
                  </button>
                  <button className="btn btn-ghost" onClick={() => setTab('vitrine')}>Configurar vitrine</button>
                </div>
              </div>
            ) : (
              <div className="grid-3">
                {products.map((p) => (
                  <article className="card product-card" key={p.id}>
                    {p.photo_url ? <PImg className="product-img" src={p.photo_url} alt={p.name} /> : <div className="product-img" style={{ background: '#eee' }} />}
                    <div className="pad">
                      <strong>{p.name}</strong>
                      <div className="row">
                        <span className="price">{money(p.price)}</span>
                        {Number(p.compare_at) > 0 && <span className="old">{money(p.compare_at)}</span>}
                      </div>
                      <div className="row" style={{ marginTop: 10 }}>
                        <button className="btn btn-ghost" onClick={() => setProduct(p)}>Editar</button>
                        <button
                          className="btn btn-rose"
                          onClick={() => {
                            if (!window.confirm(`Apagar "${p.name}"?`)) return
                            deleteProduct(p.id).catch((err) => setError(err.message || 'Falha ao apagar.'))
                          }}
                        >
                          Apagar
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        {tab === 'pedidos' && (
          <section className="card pad">
            <h3>Pedidos</h3>
            {orders.length === 0 && <p className="help">Os pedidos feitos pelo WhatsApp aparecem aqui em tempo real, com som.</p>}
            {orders.length > 0 && (
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
            )}
          </section>
        )}

        {tab === 'links' && (
          <section className="card pad stack">
            <h3>Botões da bio</h3>
            <p>Aparecem acima da vitrine, no mesmo link.</p>
            {(form.links || []).map((link, idx) => (
              <div className="link-row" key={link.id}>
                <input
                  value={link.label}
                  placeholder="Rótulo (ex.: Instagram)"
                  onChange={(e) => {
                    const links = [...form.links]
                    links[idx] = { ...link, label: e.target.value }
                    setForm({ ...form, links })
                  }}
                />
                <input
                  value={link.url}
                  placeholder="https://"
                  onChange={(e) => {
                    const links = [...form.links]
                    links[idx] = { ...link, url: e.target.value }
                    setForm({ ...form, links })
                  }}
                />
                <button
                  type="button"
                  className="btn-x"
                  aria-label={`Remover botão ${link.label || idx + 1}`}
                  title="Remover este botão"
                  onClick={() => {
                    const links = (form.links || []).filter((_, i) => i !== idx)
                    setForm({ ...form, links })
                  }}
                >
                  ×
                </button>
              </div>
            ))}
            <div className="row">
              <button
                className="btn btn-ghost"
                onClick={() => setForm({ ...form, links: [...(form.links || []), { id: uid('link'), label: 'Novo link', url: 'https://' }] })}
              >
                Adicionar botão
              </button>
              <button className="btn btn-dark" onClick={() => persistStore(form, 'Links salvos')}>Salvar links</button>
            </div>
          </section>
        )}

        {tab === 'plano' && (
          <section className="grid-2">
            <article className="card pad stack">
              <h3>Grátis</h3>
              <p className="price">R$ 0</p>
              <ul className="list">
                <li>Até {FREE_PRODUCT_LIMIT} produtos na vitrine</li>
                <li>Pedidos formatados no WhatsApp</li>
                <li>Marca VitrineZap no rodapé da vitrine</li>
                <li>1 tema de cor</li>
              </ul>
              <span className="chip">{isPro ? 'Plano anterior' : 'Plano atual'}</span>
            </article>
            <article className={`card pad stack ${isPro ? 'card-gold' : ''}`}>
              <h3>Plano Loja</h3>
              <p className="price">{mpSubAvailable ? `${PLAN_PRICE}/mês` : `${PLAN_PRICE}/30 dias`}</p>
              <ul className="list">
                <li>Produtos ilimitados</li>
                <li>Sem a marca VitrineZap</li>
                <li>Chave PIX no pedido</li>
                <li>Todos os temas e suporte por e-mail</li>
              </ul>
              {isPro ? (
                <>
                  <span className="chip">Ativo{planEnd ? ` até ${planEnd.toLocaleDateString('pt-BR')}` : ''}</span>
                  {subActive && (
                    <button className="btn btn-ghost" disabled={subBusy} onClick={cancelSub}>
                      {subBusy ? 'Cancelando…' : 'Cancelar assinatura recorrente'}
                    </button>
                  )}
                  {billingUrl && (
                    <button className="btn btn-ghost" disabled={billingBusy} onClick={upgrade}>
                      {billingBusy ? 'Aguarde...' : 'Pagar mais um mês (avulso)'}
                    </button>
                  )}
                </>
              ) : billingUrl && mpSubAvailable ? (
                <>
                  <button className="btn btn-gold" disabled={billingBusy} onClick={subscribe}>
                    {billingBusy ? 'Gerando link…' : `Assinar · ${PLAN_PRICE}/mês`}
                  </button>
                  <button className="btn btn-ghost" disabled={billingBusy} onClick={checkSubscription}>
                    {billingBusy ? 'Verificando…' : 'Já assinei — verificar'}
                  </button>
                  <button className="btn btn-ghost" disabled={billingBusy} onClick={upgrade}>
                    {billingBusy ? 'Aguarde...' : 'Pagar avulso (Pix/cartão)'}
                  </button>
                </>
              ) : billingUrl ? (
                <>
                  <button className="btn btn-gold" disabled={billingBusy} onClick={upgrade}>
                    {billingBusy ? 'Aguarde...' : `Pagar avulso · ${PLAN_PRICE}/30 dias`}
                  </button>
                </>
              ) : (
                <>
                  <button className="btn btn-gold" onClick={demoActivate}>Ativar neste ambiente</button>
                  <p className="help">
                    Sem cobrança configurada neste ambiente. Para simular, ative o plano aqui.
                  </p>
                </>
              )}
              {!isPro && !billingUrl && (
                <button className="btn btn-ghost" onClick={demoActivate}>Ativar plano de teste</button>
              )}
              {!billingUrl && isPro && (
                <p className="help">Ambiente de demonstração: o plano foi ativado manualmente.</p>
              )}
              <p className="help">
                {mpSubAvailable
                  ? 'Assinatura mensal automática: a primeira cobrança é paga na página do Mercado Pago (Pix ou cartão) e as próximas são cobradas todo mês até você cancelar — sem fidelidade.'
                  : 'Pagamento avulso via link seguro (Pix ou cartão): na confirmação, o plano é liberado automaticamente por 30 dias via webhook.'}
              </p>
            </article>
          </section>
        )}
      </main>
    </div>
  )
}
