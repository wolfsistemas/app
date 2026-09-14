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
<tr><td style="padding:16px 24px;background:#f7f1e6;color:#98a59c;font-size:12px;">VitrineZap — catálogo e pedidos no WhatsApp</td></tr>
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

// E-mail de confirmacao/retomada do pedido para o cliente.
export function orderEmail(order: any, storeName: string): { subject: string; html: string; text: string } {
  const code = order.code ? '#' + order.code : order.id
  const link = orderPublicLink(order)
  const pendingPix = order.payment_status === 'pending' && order.payment_method === 'pix'
  const subject = `Pedido ${code}${storeName ? ' - ' + storeName : ''}`
  const intro = pendingPix
    ? 'Falta concluir o pagamento por Pix. Abra o pedido e pague na hora:'
    : 'Recebemos seu pedido. Acompanhe o andamento pelo link:'
  const button = link
    ? `<p style="margin:18px 0;"><a href="${link}" style="display:inline-block;background:#0b3d2c;color:#fff;text-decoration:none;font-weight:bold;padding:13px 22px;border-radius:999px;">${pendingPix ? 'Pagar com Pix' : 'Acompanhar pedido'}</a></p>`
    : ''
  const inner = `
    <p style="margin:0 0 12px;color:#5d6d64;line-height:1.6;">Olá${order.customer_name ? ' ' + order.customer_name : ''}! Seu pedido ${code}${storeName ? ' na ' + storeName : ''} foi registrado.</p>
    ${itemsTable(order)}
    <p style="margin:0 0 12px;font-weight:bold;">Total: ${formatBrl(order.total)}</p>
    <p style="margin:0 0 4px;color:#5d6d64;line-height:1.6;">${intro}</p>
    ${button}
    <p style="margin:0;color:#98a59c;font-size:12px;line-height:1.6;">Qualquer dúvida, fale com a loja pelo WhatsApp.</p>`
  const text = `Pedido ${code}${storeName ? ' na ' + storeName : ''}\nTotal: ${formatBrl(order.total)}\n${link ? '\nAcompanhe: ' + link : ''}`
  return { subject, html: emailLayout(`Pedido ${code}`, inner), text }
}

// Avisa o cliente (uma vez). Marca customer_notified_at ao enviar.
export async function sendCustomerOrderEmail(order: any, storeName: string): Promise<boolean> {
  const to = String(order?.customer_email || '').trim()
  if (!isEmail(to)) return false
  if (order?.customer_notified_at) return false
  const { subject, html, text } = orderEmail(order, storeName)
  const result = await sendEmail({ to, subject, html, text })
  if (!result.ok) return false
  try {
    await sb(`/orders?id=eq.${encodeURIComponent(order.id)}`, {
      method: 'PATCH',
      prefer: 'return=minimal',
      payload: { customer_notified_at: new Date().toISOString() }
    })
  } catch {
    // nao critico
  }
  return true
}
