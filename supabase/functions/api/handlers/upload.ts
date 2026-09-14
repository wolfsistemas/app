// Upload de imagem (ImgBB). Exige usuario autenticado (ou UPLOAD_TOKEN).
import { json, bearer, env } from '../_shared/http.ts'
import { getAuthUser } from '../_shared/supabase.ts'
import { uploadImage } from '../_shared/misc.ts'

export async function upload(req: Request, body: Record<string, unknown>) {
  const tokenCfg = env('UPLOAD_TOKEN')
  const provided = String(body.token || '')
  const user = await getAuthUser(String(body.access_token || bearer(req)))
  const okToken = Boolean(tokenCfg) && provided === tokenCfg
  if (!user && !okToken) return json({ ok: false, error: 'Nao autorizado' }, 401)

  const result = await uploadImage(String(body.image || ''), String(body.name || ''))
  return json(result)
}
