import { loadEnv } from 'vite'

async function readJson(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString('utf8')
  if (!raw) return {}
  return JSON.parse(raw)
}

function send(res, status, body) {
  const json = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'content-type')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.end(json)
}

async function handle(req, res, apiKey) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'content-type')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')

  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
    return
  }

  if (req.method !== 'POST') {
    send(res, 405, { error: 'Método não permitido' })
    return
  }

  if (!apiKey) {
    send(res, 500, { error: 'IMGBB_API_KEY não configurada no servidor.' })
    return
  }

  try {
    const payload = await readJson(req)
    if (!payload.image) {
      send(res, 400, { error: 'Imagem ausente.' })
      return
    }
    const form = new FormData()
    form.set('key', apiKey)
    form.set('image', payload.image)
    if (payload.name) form.set('name', String(payload.name).slice(0, 80))

    const imgbb = await fetch('https://api.imgbb.com/1/upload', {
      method: 'POST',
      body: form
    })
    const result = await imgbb.json()
    if (!imgbb.ok || !result?.data?.url) {
      send(res, 502, { error: result?.error?.message || 'ImgBB recusou o upload.' })
      return
    }
    send(res, 200, {
      url: result.data.display_url || result.data.url,
      thumb: result.data.thumb?.url || result.data.url
    })
  } catch (err) {
    send(res, 500, { error: err.message || 'Falha no upload.' })
  }
}

export function imgbbUploadPlugin() {
  const env = loadEnv(process.env.NODE_ENV || 'development', process.cwd(), '')
  const apiKey = env.IMGBB_API_KEY || process.env.IMGBB_API_KEY || ''

  function attach(server) {
    server.middlewares.use((req, res, next) => {
      const url = req.url?.split('?')[0]
      if (url !== '/api/upload') return next()
      handle(req, res, apiKey)
    })
  }

  return {
    name: 'imgbb-upload',
    configureServer: attach,
    configurePreviewServer: attach
  }
}
