// Push (via Edge Function push-notify) e upload de imagem (ImgBB).
import { env } from './http.ts'
import { notify } from './email.ts'

export function pushConfigured(): boolean {
  return Boolean(env('PUSH_FUNCTION_URL') && env('PUSH_SECRET'))
}

export async function sendPush(storeId: string, title: string, body: string, url: string): Promise<any> {
  const fnUrl = env('PUSH_FUNCTION_URL')
  const secret = env('PUSH_SECRET')
  if (!fnUrl || !secret) return { ok: false, error: 'push nao configurado' }
  try {
    const res = await fetch(fnUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-push-secret': secret },
      body: JSON.stringify({ action: 'send', store_id: storeId, title, body, url: url || '' })
    })
    if (res.status >= 300) {
      const text = await res.text()
      await notify(`Falha ao enviar push (loja ${storeId})`, text.slice(0, 400))
      return { ok: false, error: 'push http ' + res.status }
    }
    return { ok: true }
  } catch (err) {
    await notify('Erro ao enviar push', String(err))
    return { ok: false, error: String(err) }
  }
}

export async function uploadImage(image: string, name: string): Promise<any> {
  const key = env('IMGBB_API_KEY')
  if (!key) return { ok: false, error: 'IMGBB_API_KEY ausente' }
  if (!image) return { ok: false, error: 'Imagem ausente' }
  const form = new FormData()
  form.append('key', key)
  form.append('image', image)
  form.append('name', name || 'vitrinezap')
  const res = await fetch('https://api.imgbb.com/1/upload', { method: 'POST', body: form })
  let parsed: any = {}
  try {
    parsed = await res.json()
  } catch {
    parsed = {}
  }
  const url = parsed?.data && (parsed.data.display_url || parsed.data.url)
  if (!url) return { ok: false, error: parsed?.error?.message || 'ImgBB recusou o upload' }
  return { ok: true, url, thumb: parsed.data.thumb && parsed.data.thumb.url }
}
