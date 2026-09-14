// Envio de e-mail (Resend) + templates HTML do VitrineZap.
import { env, isEmail, formatBrl } from './http.ts'
import { sb } from './supabase.ts'

export function appUrl(): string {
  return env('APP_URL').replace(/\/+$/, '')
}

export function orderPublicLink(order: any): string {
  const base = appUrl()
  if (!base || !order?.public_token) return ''
  return `${base}/pedido/${order.public_token}`
}

type SendArgs = { to: string; subject: string; html?: string; text?: string; replyTo?: string }

export async function sendEmail({ to, subject, html, text, replyTo }: SendArgs): Promise<any> {
  const key = env('RESEND_API_KEY')
  const from = env('EMAIL_FROM', 'VitrineZap <onboarding@resend.dev>')
  if (!isEmail(to)) return { ok: false, skipped: 'email invalido' }
  if (!key) {
    console.log('email skip (sem RESEND_API_KEY)', { to, subject })
    return { ok: false, skipped: 'sem provedor' }
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      html: html || undefined,
      text: text || undefined,
      reply_to: replyTo || undefined
    })
  })
  const text2 = await res.text()
  if (res.status >= 300) {
    console.error('resend falhou', res.status, text2.slice(0, 300))
    return { ok: false, error: text2.slice(0, 200) }
  }
  let id = ''
  try {
    id = JSON.parse(text2).id || ''
  } catch {
    id = ''
  }
  return { ok: true, id }
}

// Log/aviso interno para o suporte.
export async function notify(subject: string, body: string): Promise<void> {
  const to = env('EMAIL_LOG', 'wolfsaasbr@gmail.com')
  try {
    await sendEmail({ to, subject: '[VitrineZap] ' + subject, text: String(body).slice(0, 4000) })
  } catch (err) {
    console.log('falha notify', String(err))
  }
}

export function emailLayout(title: string, inner: string): string {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f4efe6;font-family:Arial,Helvetica,sans-serif;color:#14221b;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4efe6;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:540px;background:#fffdf8;border:1px solid #d7e3d8;border-radius:16px;overflow:hidden;">
<tr><td style="background:#0b3d2c;padding:18px 24px;color:#fff;font-size:20px;font-weight:bold;">VitrineZap</td></tr>
<tr><td style="padding:24px;">
<h1 style="margin:0 0 12px;font-size:20px;color:#14221b;">${title}</h1>
${inner}
</td></tr>
<tr><td style="padding:16px 16px 8px;background:#f7f1e6;color:#98a59c;font-size:12px;">VitrineZap — catálogo e pedidos no WhatsApp</td></tr>
<tr><td style="padding:0 16px 16px;background:#f7f1e6;color:#98a59c;font-size:11px;line-height:1.6;">Este e-mail é sobre um pedido feito no catálogo da loja. Se você não reconhece, ignore esta mensagem.</td></tr>
</table></td></tr></table></body></html>`
}

function itemsTable(order: any): string {
  const items = Array.isArray(order?.items) ? order.items : []
  const rows = items
    .map(
      (i: any) =>
        `<tr><td style="padding:6px 0;color:#14221b;">${Number(i.qty || 1)}x ${String(i.name || '')}</td>` +
        `<td style="padding:6px 0;text-align:right;color:#14221b;">${formatBrl(Number(i.price || 0) * Number(i.qty || 1))}</td></tr>`
    )
    .join('')
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:12px 0;border-top:1px solid #e7efe7;border-bottom:1px solid #e7efe7;">${rows}</table>`
}

function summaryTable(order: any): string {
  const subtotal = Number(order?.subtotal || 0)
  const fee = Number(order?.delivery_fee || 0)
  const total = Number(order?.total || 0)
  const rows: string[] = []
  if (subtotal > 0) {
    rows.push(
      `<tr><td style="padding:2px 0;color:#5d6d64;">Subtotal</td><td style="padding:2px 0;text-align:right;color:#5d6d64;">${formatBrl(subtotal)}</td></tr>`
    )
    rows.push(
      `<tr><td style="padding:2px 0;color:#5d6d64;">Entrega</td><td style="padding:2px 0;text-align:right;color:#5d6d64;">${fee > 0 ? formatBrl(fee) : 'grátis'}</td></tr>`
    )
  }
  rows.push(
    `<tr><td style="padding:6px 0 0;font-weight:bold;">Total</td><td style="padding:6px 0 0;text-align:right;font-weight:bold;">${formatBrl(total)}</td></tr>`
  )
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.join('')}</table>`
}

function addressLine(order: any): string {
  const a = order?.address
  if (!a || typeof a !== 'object') return ''
  const cep = String(a.cep || '').replace(/\D/g, '')
  const line1 = [a.street, a.number].filter(Boolean).join(', ')
  const line2 = [a.complement, a.district].filter(Boolean).join(' - ')
  const line3 = [a.city, a.state].filter(Boolean).join('/')
  const cepLabel = cep.length === 8 ? `CEP ${cep.slice(0, 5)}-${cep.slice(5)}` : ''
  return [line1, line2, line3, cepLabel].filter(Boolean).join(' · ')
}

function deliveryBlock(order: any): string {
  if (order?.delivery_type === 'retirada') {
    return `<p style="margin:0 0 4px;color:#5d6d64;line-height:1.6;"><strong>Retirada na loja</strong>${order.delivery_zone ? '' : ''}</p>`
  }
  const addr = addressLine(order)
  if (!addr) return ''
  return `<p style="margin:0 0 4px;color:#5d6d64;line-height:1.6;"><strong>Entrega:</strong> ${addr}</p>`
}

type Kind = 'created' | 'paid' | 'shipped' | 'expired'

const KIND_COPY: Record<Kind, { title: string; intro: string; cta: string }> = {
  created: {
    title: 'Pedido recebido',
    intro: 'Recebemos seu pedido. Acompanhe o andamento pelo link:',
    cta: 'Acompanhar pedido'
  },
  paid: {
    title: 'Pagamento confirmado',
    intro: 'Seu pagamento foi confirmado e a loja já foi avisada. Acompanhe o preparo pelo link:',
    cta: 'Ver meu pedido'
  },
  shipped: {
    title: 'Pedido enviado',
    intro: 'Seu pedido saiu para entrega. Acompanhe pelo link:',
    cta: 'Acompanhar entrega'
  },
  expired: {
    title: 'Seu pedido está esperando',
    intro: 'O prazo do Pix venceu e o pedido ainda não foi pago. Abra o link para gerar um novo Pix e concluir:',
    cta: 'Concluir meu pedido'
  }
}

// E-mail do pedido para o cliente (criado/pago/enviado/expirado).
export function orderEmail(order: any, storeName: string, kind: Kind = 'created'): { subject: string; html: string; text: string } {
  const copy = KIND_COPY[kind] || KIND_COPY.created
  const code = order.code ? '#' + order.code : order.id
  const link = orderPublicLink(order)
  const pendingPix = order.payment_status === 'pending' && order.payment_method === 'pix'
  const subject = `${copy.title} - Pedido ${code}${storeName ? ' - ' + storeName : ''}`
  const intro =
    kind === 'created' && pendingPix
      ? 'Falta concluir o pagamento por Pix. Abra o pedido e pague na hora:'
      : copy.intro
  const ctaLabel = kind === 'created' && pendingPix ? 'Pagar com Pix' : copy.cta
  const button = link
    ? `<p style="margin:18px 0;"><a href="${link}" style="display:inline-block;background:#0b3d2c;color:#fff;text-decoration:none;font-weight:bold;padding:13px 22px;border-radius:999px;">${ctaLabel}</a></p>`
    : ''
  const inner = `
    <p style="margin:0 0 12px;color:#5d6d64;line-height:1.6;">Olá${order.customer_name ? ' ' + order.customer_name : ''}! Seu pedido ${code}${storeName ? ' na ' + storeName : ''}.</p>
    ${itemsTable(order)}
    ${summaryTable(order)}
    ${deliveryBlock(order)}
    <p style="margin:12px 0 4px;color:#5d6d64;line-height:1.6;">${intro}</p>
    ${button}
    <p style="margin:0;color:#98a59c;font-size:12px;line-height:1.6;">Qualquer dúvida, fale com a loja pelo WhatsApp.</p>`
  const text = `Pedido ${code}${storeName ? ' na ' + storeName : ''}\nTotal: ${formatBrl(order.total)}\n${link ? '\nAcompanhe: ' + link : ''}`
  return { subject, html: emailLayout(`${copy.title} · Pedido ${code}`, inner), text }
}

// Envia o e-mail do pedido ao cliente.
// - kind 'created': envia só uma vez (marca customer_notified_at).
// - outros: o chamador garante o envio único.
export async function sendOrderKindEmail(order: any, storeName: string, kind: Kind = 'created'): Promise<boolean> {
  const to = String(order?.customer_email || '').trim()
  if (!isEmail(to)) return false
  if (kind === 'created' && order?.customer_notified_at) return false
  const { subject, html, text } = orderEmail(order, storeName, kind)
  const result = await sendEmail({ to, subject, html, text })
  if (!result.ok) return false
  if (kind === 'created') {
    try {
      await sb(`/orders?id=eq.${encodeURIComponent(order.id)}`, {
        method: 'PATCH',
        prefer: 'return=minimal',
        payload: { customer_notified_at: new Date().toISOString() }
      })
    } catch {
      // nao critico
    }
  }
  return true
}

// Compatibilidade: e-mail inicial de criacao/retomada.
export async function sendCustomerOrderEmail(order: any, storeName: string): Promise<boolean> {
  return sendOrderKindEmail(order, storeName, 'created')
}
