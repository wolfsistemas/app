import { isSupabase, supabase } from './supabase'

const VAPID = import.meta.env.VITE_VAPID_PUBLIC_KEY || ''

export function pushSupported() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

export function pushPermission() {
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const output = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i)
  return output
}

async function registration() {
  await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`)
  return navigator.serviceWorker.ready
}

export async function hasLocalPushSubscription() {
  if (!pushSupported()) return false
  try {
    const reg = await navigator.serviceWorker.getRegistration()
    if (!reg) return false
    const sub = await reg.pushManager.getSubscription()
    return Boolean(sub)
  } catch {
    return false
  }
}

export async function enablePush(storeId) {
  if (!pushSupported()) throw new Error('Este navegador não suporta notificações.')
  if (!VAPID) throw new Error('Notificações não configuradas neste ambiente.')
  if (!storeId) throw new Error('Loja não identificada.')

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Permissão de notificação negada.')

  const reg = await registration()
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID)
    })
  }

  const json = sub.toJSON()
  if (isSupabase) {
    const { error } = await supabase.from('push_subscriptions').upsert(
      {
        store_id: storeId,
        endpoint: sub.endpoint,
        p256dh: json.keys?.p256dh || '',
        auth: json.keys?.auth || '',
        user_agent: navigator.userAgent || ''
      },
      { onConflict: 'endpoint' }
    )
    if (error) throw error
  }
  return true
}

export async function disablePush() {
  if (!pushSupported()) return false
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = reg ? await reg.pushManager.getSubscription() : null
  if (sub) {
    const endpoint = sub.endpoint
    try {
      await sub.unsubscribe()
    } catch {
      // segue para remover do banco
    }
    if (isSupabase) {
      await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint)
    }
  }
  return true
}
