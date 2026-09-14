// Conta do lojista: exclusao (LGPD) e teste de push.
import { json, bearer, env } from '../_shared/http.ts'
import { assertStoreOwner, SB_URL, SB_SERVICE } from '../_shared/supabase.ts'
import { sendPush, pushConfigured } from '../_shared/misc.ts'
import { notify } from '../_shared/email.ts'

export async function pushTest(req: Request, body: Record<string, unknown>) {
  const storeId = String(body.store_id || '')
  if (!storeId) return json({ ok: false, error: 'store_id ausente' })
  const check = await assertStoreOwner(storeId, String(body.access_token || bearer(req)))
  if (!check.ok) return json(check)
  if (!pushConfigured()) return json({ ok: false, error: 'Push nao configurado no servidor' })
  const base = env('APP_URL').replace(/\/+$/, '')
  return json(await sendPush(storeId, 'VitrineZap', 'Teste de alerta. Se voce recebeu, esta funcionando!', base ? base + '/painel' : ''))
}

// LGPD: apaga o usuario de auth. As FKs usam ON DELETE CASCADE
// (auth.users -> stores -> products/orders/store_payments/push_subscriptions).
export async function deleteAccount(req: Request, body: Record<string, unknown>) {
  const storeId = String(body.store_id || '')
  if (!storeId) return json({ ok: false, error: 'store_id ausente' })
  const check = await assertStoreOwner(storeId, String(body.access_token || bearer(req)))
  if (!check.ok) return json(check)
  const ownerId = String(check.row.owner_id || '')
  if (!ownerId) return json({ ok: false, error: 'Dono da loja nao encontrado' })

  const res = await fetch(`${SB_URL}/auth/v1/admin/users/${encodeURIComponent(ownerId)}`, {
    method: 'DELETE',
    headers: { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}` }
  })
  if (res.status >= 300 && res.status !== 404) {
    const text = await res.text()
    await notify(`Falha ao excluir conta ${ownerId}`, text.slice(0, 500))
    return json({ ok: false, error: 'Nao foi possivel excluir a conta agora. Tente de novo ou fale com o suporte.' })
  }
  await notify('Conta excluida', `Loja ${storeId} (${check.row.name || ''}) e usuario ${ownerId} removidos.`)
  return json({ ok: true })
}
