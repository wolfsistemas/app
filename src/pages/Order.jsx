import React, { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { createPix, getOrderPublic } from '../lib/payments.js'
import { isSupabase, supabase } from '../lib/supabase.js'
import { money, onlyDigits } from '../lib/format.js'
import Brand from '../components/Brand.jsx'
import { useToast } from '../components/Toast.jsx'

const STATUS = {
  paid: { label: 'Pagamento confirmado', tone: 'ok' },
  pending: { label: 'Aguardando pagamento', tone: 'wait' },
  failed: { label: 'Pagamento não aprovado', tone: 'bad' },
  refunded: { label: 'Pagamento estornado', tone: 'bad' }
}

const STEPS = ['Recebido', 'Em preparo', 'Enviado', 'Entregue']
const FULFILL_STEP = {
  novo: 0,
  atendido: 1,
  preparando: 1,
  enviado: 2,
  entregue: 3
}

const PIX_TTL_MS = 30 * 60 * 1000

export default function Order() {
  const { token } = useParams()
  const showToast = useToast()
  const [order, setOrder] = useState(null)
  const [storeName, setStoreName] = useState('')
  const [storePhone, setStorePhone] = useState('')
  const [missing, setMissing] = useState(false)
  const [loading, setLoading] = useState(true)
  const [pixBusy, setPixBusy] = useState(false)
  const storeLoaded = useRef(false)

  useEffect(() => {
    let alive = true
    let timer = null

    async function load() {
      try {
        const row = await getOrderPublic(token)
        if (!alive) return
        if (!row) {
          setMissing(true)
          setLoading(false)
          return
        }
        setOrder(row)
        setLoading(false)

        if (!storeLoaded.current && isSupabase && row.store_id) {
          storeLoaded.current = true
          supabase
            .from('stores')
            .select('name, whatsapp')
            .eq('id', row.store_id)
            .maybeSingle()
            .then(({ data }) => {
              if (alive && data) {
                setStoreName(data.name || '')
                setStorePhone(data.whatsapp || '')
              }
            })
        }

        const waitingPix = row.payment_status === 'pending' && Boolean(row.payment_code) && !isExpired(row)
        const tracking = row.status !== 'entregue' && row.status !== 'cancelado'
        if (waitingPix || tracking) {
          timer = window.setTimeout(load, 6000)
        }
      } catch {
        if (alive) {
          setMissing(true)
          setLoading(false)
        }
      }
    }

    load()
    return () => {
      alive = false
      if (timer) window.clearTimeout(timer)
    }
  }, [token])

  async function copyCode() {
    if (!order?.payment_code) return
    try {
      await navigator.clipboard.writeText(order.payment_code)
      showToast('Código Pix copiado', 'ok')
    } catch {
      showToast('Não foi possível copiar o código', 'info')
    }
  }

  async function regeneratePix() {
    setPixBusy(true)
    try {
      await createPix({ storeId: order.store_id, orderId: order.id, renew: true })
      const row = await getOrderPublic(token)
      if (row) setOrder(row)
      showToast('Novo Pix gerado', 'ok')
    } catch (err) {
      showToast(err.message || 'Não foi possível gerar o Pix', 'bad')
    } finally {
      setPixBusy(false)
    }
  }

  if (loading) {
    return <main className="wrap" style={{ padding: 48 }}>Abrindo pedido...</main>
  }

  if (missing || !order) {
    return (
      <main className="wrap center" style={{ padding: 48 }}>
        <h2>Pedido não encontrado</h2>
        <p>Confira o link ou fale com a loja.</p>
        <Link className="btn btn-dark" to="/">Voltar ao início</Link>
      </main>
    )
  }

  const status = STATUS[order.payment_status] || STATUS.pending
  const items = order.items || []
  const code = order.code ? String(order.code).padStart(3, '0') : ''
  const expired = order.payment_status === 'pending' && isExpired(order)
  const step = FULFILL_STEP[order.status] ?? 0
  const phone = onlyDigits(storePhone)
  const waText = encodeURIComponent(`Olá! Fiz o pedido${code ? ` nº ${code}` : ''} no valor de ${money(order.total)}.`)

  return (
    <div className="theme-bosque">
      <header className="store-hero" style={{ minHeight: 160 }}>
        <div className="wrap stack">
          <Brand onDark />
        </div>
      </header>

      <main className="wrap" style={{ padding: '18px 0 90px' }}>
        <section className="card pad stack" style={{ maxWidth: 560, margin: '0 auto' }}>
          <div className="between">
            <h2 style={{ margin: 0 }}>{storeName || 'Pedido'}</h2>
            <span className="chip">Pedido {code ? `nº ${code}` : ''}</span>
          </div>

          <div className={`chip status-${status.tone}`}>{status.label}</div>

          <div className="stack" style={{ gap: 6 }}>
            {items.map((i, idx) => (
              <div className="between" key={idx}>
                <span>
                  {i.qty || 1}x {i.name}
                </span>
                <span>{money(Number(i.price || 0) * (i.qty || 1))}</span>
              </div>
            ))}
            <div className="between" style={{ borderTop: '1px solid var(--line, #e5e0d5)', paddingTop: 8 }}>
              <strong>Total</strong>
              <strong>{money(order.total)}</strong>
            </div>
          </div>

          {order.payment_status === 'paid' && order.status !== 'cancelado' && (
            <div className="stack" style={{ gap: 8 }}>
              <p className="ok" style={{ margin: 0 }}>
                Recebemos o seu pagamento. A loja foi avisada.
              </p>
              <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
                {STEPS.map((label, idx) => (
                  <span key={label} className={`chip ${idx <= step ? 'status-ok' : 'status-wait'}`}>
                    {idx <= step ? '✓ ' : ''}
                    {label}
                  </span>
                ))}
              </div>
              {order.status === 'entregue' && <p className="help">Pedido entregue. Obrigado!</p>}
              {order.status === 'enviado' && <p className="help">Seu pedido saiu para entrega.</p>}
            </div>
          )}

          {order.payment_status === 'pending' && order.payment_code && !expired && (
            <>
              <p className="help">Pague com o Pix abaixo. Esta página confirma sozinha assim que o pagamento cair.</p>
              {order.payment_qr && (
                <img
                  src={`data:image/png;base64,${order.payment_qr}`}
                  alt="QR Code Pix"
                  style={{ width: 'min(280px, 100%)', alignSelf: 'center', borderRadius: 12, background: '#fff', padding: 8 }}
                />
              )}
              <textarea readOnly value={order.payment_code} rows={4} onFocus={(e) => e.target.select()} />
              <button className="btn btn-gold" onClick={copyCode}>Copiar código Pix</button>
              <p className="help">Válido até {new Date(expiresAt(order)).toLocaleString('pt-BR')}.</p>
            </>
          )}

          {expired && (
            <>
              <p className="help">Este Pix expirou. Gere um novo para concluir o pagamento.</p>
              <button className="btn btn-dark" disabled={pixBusy} onClick={regeneratePix}>
                {pixBusy ? 'Gerando...' : 'Gerar novo Pix'}
              </button>
            </>
          )}

          {order.payment_status === 'pending' && !order.payment_code && (
            <p className="help">A loja ainda vai gerar a cobrança. Atualize a página em instantes.</p>
          )}

          {order.payment_status === 'failed' && (
            <p className="help">O pagamento não foi aprovado. Fale com a loja para tentar de novo.</p>
          )}

          {phone && (
            <a
              className="btn btn-whats"
              href={`https://wa.me/${phone}?text=${waText}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Falar com a loja
            </a>
          )}
        </section>
      </main>
    </div>
  )

  function isExpired(row) {
    const at = expiresAt(row)
    return at > 0 && Date.now() > at
  }

  function expiresAt(row) {
    if (row.payment_expires_at) return new Date(row.payment_expires_at).getTime()
    if (row.created_at) return new Date(row.created_at).getTime() + PIX_TTL_MS
    return 0
  }
}
