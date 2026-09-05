const MAX_EDGE = 1400
const JPEG_QUALITY = 0.82

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

export async function uploadPhoto(file) {
  const blob = await compressImage(file)
  const image = await blobToBase64(blob)
  const endpoint = import.meta.env.VITE_UPLOAD_URL || (import.meta.env.DEV ? '/api/upload' : '')
  if (!endpoint) {
    throw new Error('No GitHub Pages, cole o link da foto ou configure o GAS (VITE_UPLOAD_URL).')
  }
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image,
      name: (file.name || 'produto').replace(/\.[^.]+$/, '')
    })
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.url) {
    throw new Error(data.error || 'Falha no upload da imagem.')
  }
  return data.url
}
