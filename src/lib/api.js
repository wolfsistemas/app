// Cliente da API do VitrineZap (Supabase Edge Function "api").
export const apiUrl = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '')

export function apiEnabled() {
  return Boolean(apiUrl)
}

export async function api(action, payload = {}) {
  if (!apiUrl) throw new Error('Servidor ainda não configurado neste ambiente.')
  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload })
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.ok === false) {
    throw new Error(data.message || data.error || 'Falha na comunicação com o servidor.')
  }
  return data
}
