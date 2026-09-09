import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createSubscription, mpPublicKey } from '../lib/billing.js'
import { PLAN_PRICE, PLAN_PRICE_CENTS } from '../lib/format.js'

const MP_SDK = 'https://sdk.mercadopago.com/js/v2'

function loadMpSdk() {
  return new Promise((resolve, reject) => {
    if (window.MercadoPago || window.Mercadopago) return resolve()
    const s = document.createElement('script')
    s.src = MP_SDK
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Falha ao carregar o SDK do Mercado Pago.'))
    document.head.appendChild(s)
  })
}

export default function MPBrickModal({ open, onClose, storeId, email, name, onSuccess }) {
  const [phase, setPhase] = useState('boot') // boot | form | sending | success | error
  const [errMsg, setErrMsg] = useState('')
  const [brickError, setBrickError] = useState('')
  const controllerRef = useRef(null)
  const containerId = useMemo(() => `mpbrick-${Math.random().toString(36).slice(2, 10)}`, [])
  const amount = useMemo(() => PLAN_PRICE_CENTS / 100, [])

  // Só monta o brick quando o modal abre (componente é renderizado condicionalmente).
  useEffect(() => {
    if (!open) return undefined
    let dead = false
    setPhase('boot')
    setBrickError('')
    setErrMsg('')

    async function boot() {
      try {
        await loadMpSdk()
        if (dead) return
        const MP = window.MercadoPago || window.Mercadopago
        const mp = new MP(mpPublicKey)
        const builder = mp.bricks ? mp.bricks() : window.MercadoPago.bricks()
        const settings = {
          initialization: { amount },
          locale: 'pt-BR',
          callbacks: {
            onReady: () => {
              if (!dead) setPhase('form')
            },
            onSubmit: (cardData) =>
              new Promise((resolve, reject) => {
                setPhase('sending')
                setErrMsg('')
                const token = String(
                  cardData?.token ||
                    cardData?.cardTokenId ||
                    cardData?.card_token_id ||
                    cardData?.cardToken ||
                    ''
                )
                if (!token) {
                  setErrMsg('Não foi possível tokenizar o cartão. Tente novamente.')
                  setPhase('form')
                  reject(new Error('card token ausente'))
                  return
                }
                createSubscription({ storeId, email, name, cardToken: token })
                  .then(() => {
                    if (dead) return
                    setPhase('success')
                    resolve()
                    window.setTimeout(() => {
                      if (!dead && onSuccess) onSuccess()
                    }, 1200)
                  })
                  .catch((err) => {
                    if (dead) return
                    const msg = err.message || ''
                    setErrMsg(
                      /used|consumido|já foi usado|Ambientes diferentes/i.test(msg)
                        ? `${msg} Basta clicar em pagar de novo — o formulário gera um token novo a cada tentativa.`
                        : msg
                    )
                    setPhase('form')
                    reject(err)
                  })
              }),
            onError: (error) => {
              if (dead) return
              setBrickError(String(error?.message || error || 'Erro no formulário de cartão.'))
              setPhase('error')
            }
          }
        }
        controllerRef.current = await builder.create('cardPayment', containerId, settings)
        if (dead) unmountBrick()
      } catch (err) {
        if (!dead) {
          setBrickError(err.message || 'Erro ao preparar o formulário de cartão.')
          setPhase('error')
        }
      }
    }
    boot()

    return () => {
      dead = true
      unmountBrick()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function unmountBrick() {
    const c = controllerRef.current
    if (c && c.unmount) {
      try {
        c.unmount()
      } catch (err) {
        /* já removido */
      }
    }
    controllerRef.current = null
  }

  if (!open) return null

  const busy = phase === 'boot' || phase === 'sending'
  const canClose = !busy

  return (
    <div className="modal-overlay" onClick={canClose ? onClose : undefined}>
      <div className="card modal-box pad rel" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="modal-close"
          onClick={onClose}
          disabled={!canClose}
          aria-label="Fechar"
        >
          ×
        </button>

        {phase !== 'success' && (
          <>
            <h3 className="h3">Assinar o Plano Loja</h3>
            <p className="price">{PLAN_PRICE}/mês</p>
            <p className="help">
              Cobrança mensal automática no cartão. Sem fidelidade: cancele quando quiser — o
              acesso continua até o fim do mês pago.
            </p>
          </>
        )}

        {phase === 'boot' && <p className="help">Carregando o formulário de cartão seguro…</p>}

        {phase === 'sending' && (
          <p className="help">Confirmando sua assinatura com o Mercado Pago…</p>
        )}

        {phase !== 'success' && <div id={containerId} />}

        {phase === 'success' && (
          <>
            <p className="price">Assinatura confirmada!</p>
            <p className="help">
              Seu plano está sendo ativado. Assim que confirmarmos a primeira cobrança, a vitrine
              fica liberada automaticamente.
            </p>
          </>
        )}

        {(phase === 'error' || errMsg) && (
          <>
            <p className="help" style={{ color: 'var(--rose)' }}>
              {errMsg || brickError}
            </p>
            {brickError && phase === 'error' && (
              <p className="help">
                Verifique se a chave pública do Mercado Pago (<code>VITE_MP_PUBLIC_KEY</code>) está
                correta no build. O cartão não é salvo pelo VitrineZap — tudo é processado pelo
                Mercado Pago.
              </p>
            )}
            <button type="button" className="btn btn-gold" onClick={() => window.location.reload()}>
              Tentar novamente
            </button>
          </>
        )}
      </div>
    </div>
  )
}
