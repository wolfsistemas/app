// Utilitarios HTTP e env para as Edge Functions do VitrineZap.

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-client-info, apikey',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' }
  })
}

export function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { ...cors, 'Content-Type': 'text/html; charset=utf-8' }
  })
}

export function env(name: string, fallback = ''): string {
  const value = Deno.env.get(name)
  return value === undefined ? fallback : String(value).trim()
}

export function isEmail(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(value || '').trim())
}

export function formatBrl(value: unknown): string {
  return 'R$ ' + Number(value || 0).toFixed(2).replace('.', ',')
}

export function bearer(req: Request): string {
  const header = req.headers.get('authorization') || ''
  return header.replace(/^Bearer\s+/i, '').trim()
}

export function parseJson(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw || '{}')
  } catch {
    return {}
  }
}

export async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const text = await req.text()
    return parseJson(text)
  } catch {
    return {}
  }
}
