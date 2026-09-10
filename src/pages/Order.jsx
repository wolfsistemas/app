import React, { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { getOrderPublic } from '../lib/payments.js'
import { isSupabase, supabase } from '../lib/supabase.js'
import { money } from '../lib/format.js'
import Brand from '../components/Brand.jsx'
import { useToast } from '../components/Toast.jsx'

const STATUS = {
  paid: { label: 'Pagamento confirmado', tone: 'ok' },
  pending: { label: 'Aguardando pagamento', tone: 'wait' },
  failed: { label: 'Pagamento não aprovado', tone: 'bad' },
  refunded: { label: 'Pagamento estornado', tone: 'bad' }
}

export default function Order() {
  const { token } = useParams()
  const showToast = useToast()
  const [order, setOrder] = useState(null)
  const [storeName, setStoreName] = useState('')
  const [missing, setMissing] = useState(false)
  const [loading, setLoading] = useState(true)

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
        if (!storeName && isSupabase && row.store_id) {
          const { data } = await supabase.from('stores').select('name').eq('id', row.store_id).maybeSingle()
          if (alive && data) setStoreName(data.name || '')
        }
        if (row.payment_status === 'pending' && row.payment_code) {
          timer = window.setTimeout(load, 5000)
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

          {order.payment_status === 'paid' && (
            <p className="ok">Recebemos o seu pagamento. A loja foi avisada e vai combinar a entrega.</p>
          )}

          {order.payment_status === 'pending' && order.payment_code && (
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
              {order.payment_expires_at && (
                <p className="help">
                  Válido até {new Date(order.payment_expires_at).toLocaleString('pt-BR')}.
                </p>
              )}
            </>
          )}

          {order.payment_status === 'pending' && !order.payment_code && (
            <p className="help">Aguardando a loja gerar a cobrança. Atualize a página em instantes.</p>
          )}

          {order.payment_status === 'failed' && (
            <p className="help">O pagamento não foi aprovado. Fale com a loja para tentar de novo.</p>
          )}
        </section>
      </main>
    </div>
  )
}
