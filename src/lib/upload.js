const MAX_EDGE = 1400
const JPEG_QUALITY = 0.82
const FOTOS_BUCKET = 'fotos'

import { isSupabase, supabase } from './supabase.js'

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result || '')
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = () => reject(new Error('Não foi possível ler a imagem.'))
    reader.readAsDataURL(blob)
  })
}

export function compressImage(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) {
      reject(new Error('Envie um arquivo de imagem.'))
      return
    }
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height))
      const width = Math.max(1, Math.round(img.width * scale))
      const height = Math.max(1, Math.round(img.height * scale))
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, width, height)
      URL.revokeObjectURL(url)
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Falha ao compactar a imagem.'))
            return
          }
          resolve(blob)
        },
        'image/jpeg',
        JPEG_QUALITY
      )
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Imagem inválida.'))
    }
    img.src = url
  })
}

async function uploadViaEndpoint(image, name) {
  const res = await fetch(import.meta.env.VITE_UPLOAD_URL, {
    method: 'POST',
    body: JSON.stringify({ image, name })
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.url) {
    throw new Error(data.error || 'Falha no upload da imagem.')
  }
  return data.url
}

async function uploadViaSupabaseStorage(blob, file) {
  if (!isSupabase) throw new Error('Nenhum destino de upload configurado.')
  const { data: authData } = await supabase.auth.getUser()
  if (!authData.user) throw new Error('Sessão expirada. Entre de novo para subir a foto.')
  const ext = (file?.name?.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  const path = `${authData.user.id}/${Date.now()}.${ext}`
  const { error } = await supabase.storage.from(FOTOS_BUCKET).upload(path, blob, {
    contentType: blob.type || 'image/jpeg',
    upsert: false
  })
  if (error) {
    if (error.message && /bucket|Bucket/i.test(error.message)) {
      throw new Error('Bucket "fotos" não existe. Rode supabase/storage.sql no SQL Editor.')
    }
    throw new Error(error.message || 'Falha ao salvar a imagem.')
  }
  const { data: pub } = supabase.storage.from(FOTOS_BUCKET).getPublicUrl(path)
  return pub.publicUrl
}

export async function uploadPhoto(file) {
  const blob = await compressImage(file)
  const name = (file.name || 'produto').replace(/\.[^.]+$/, '').slice(0, 80)

  const endpoint =
    import.meta.env.VITE_UPLOAD_URL || (import.meta.env.DEV ? '/api/upload' : '')

  if (endpoint) {
    const image = await blobToBase64(blob)
    return uploadViaEndpoint(image, name)
  }

  return uploadViaSupabaseStorage(blob, file)
}
