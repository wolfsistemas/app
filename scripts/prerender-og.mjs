// Gera uma página HTML por loja (com Open Graph, Twitter Card, canonical e
// JSON-LD) dentro de dist/<slug>/index.html, além de sitemap.xml e robots.txt.
//
// Por que isso existe: o site é uma SPA e robôs do WhatsApp/Google não executam
// JavaScript. Sem HTML pré-renderizado, todo link de vitrine mostra o mesmo
// preview genérico. Este script roda depois do `vite build`.
//
// Uso: npm run build && npm run og
// Variáveis relevantes (lidas de .env.production e .env):
//   VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY  -> fonte das lojas (RLS pública)
//   VITE_SITE_URL                              -> URL pública do app SEM barra final
//                                                 ex.: https://wolfsistemas.github.io/app

import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const DIST = path.join(ROOT, 'dist')
const INDEX = path.join(DIST, 'index.html')
const PRODUCT = 'VitrineZap'
const MAX_DESC = 200

function parseEnv(files) {
  const out = {}
  for (const file of files) {
    if (!existsSync(file)) continue
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const s = line.trim()
      if (!s || s.startsWith('#')) continue
      const i = s.indexOf('=')
      if (i < 0) continue
      const key = s.slice(0, i).trim()
      let value = s.slice(i + 1).trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      out[key] = value
    }
  }
  return out
}

function esc(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function siteFromGithubRepo(repo) {
  if (!repo || !repo.includes('/')) return ''
  const [owner, name] = repo.split('/')
  if (name === `${owner}.github.io`) return `https://${owner}.github.io`
  return `https://${owner}.github.io/${name}`
}

async function main() {
  if (!existsSync(INDEX)) {
    console.error('[og] dist/index.html não encontrado. Rode o build antes.')
    process.exit(1)
  }

  const env = { ...parseEnv([path.join(ROOT, '.env.production'), path.join(ROOT, '.env')]), ...process.env }
  const supabaseUrl = (env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
  const anonKey = env.VITE_SUPABASE_ANON_KEY || ''
  const siteUrl = ((env.VITE_SITE_URL || siteFromGithubRepo(env.GITHUB_REPOSITORY)) || '').replace(/\/$/, '')

  const original = readFileSync(INDEX, 'utf8')

  // Descobre o base path (/ ou /app/) a partir do bundle gerado pelo Vite.
  let assetBase = '/'
  const scriptMatch = original.match(/<script[^>]+src="([^"]+)"/)
  if (scriptMatch) {
    const rel = scriptMatch[1]
    const idx = rel.indexOf('assets/')
    assetBase = idx > 0 ? rel.slice(0, idx) : rel.slice(0, rel.lastIndexOf('/') + 1) || '/'
  }
  if (!assetBase.endsWith('/')) assetBase += '/'

  // Corrige referências relativas (./manifest.webmanifest etc.) para o base path,
  // pois a página vai morar em um subdiretório dist/<slug>/.
  const shell = original.replace(/(href|src)="\.\//g, `$1="${assetBase}`)

  if (!siteUrl) {
    console.warn('[og] VITE_SITE_URL não definido: canonical/sitemap serão gerados sem domínio absoluto.')
  }

  function absolute(url) {
    if (!url) return ''
    if (/^https?:\/\//i.test(url)) return url
    return siteUrl ? `${siteUrl}/${url.replace(/^\//, '')}` : url
  }

  // URL absoluta de um arquivo do próprio site (ex.: ícone).
  // VITE_SITE_URL já inclui o base path (ex.: .../app), então não repetimos assetBase.
  function baseAsset(file) {
    return siteUrl ? `${siteUrl}/${file}` : `${assetBase}${file}`
  }

  function inject(html, { title, description, image, url, jsonLd }) {
    const tags = []
    tags.push(`<meta property="og:type" content="website" />`)
    tags.push(`<meta property="og:site_name" content="${esc(PRODUCT)}" />`)
    if (title) tags.push(`<meta property="og:title" content="${esc(title)}" />`)
    if (description) tags.push(`<meta property="og:description" content="${esc(description)}" />`)
    if (image) tags.push(`<meta property="og:image" content="${esc(image)}" />`)
    if (url) tags.push(`<meta property="og:url" content="${esc(url)}" />`)
    tags.push(`<meta name="twitter:card" content="summary_large_image" />`)
    if (title) tags.push(`<meta name="twitter:title" content="${esc(title)}" />`)
    if (description) tags.push(`<meta name="twitter:description" content="${esc(description)}" />`)
    if (image) tags.push(`<meta name="twitter:image" content="${esc(image)}" />`)
    if (url) tags.push(`<link rel="canonical" href="${esc(url)}" />`)
    if (jsonLd) tags.push(`<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`)

    let out = html
    if (title) out = out.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`)
    if (description) out = out.replace(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${esc(description)}" />`)
    return out.replace('</head>', `    ${tags.join('\n    ')}\n  </head>`)
  }

  // 1) Landing
  const landingTitle = `${PRODUCT} — catálogo no WhatsApp`
  const landingDesc = 'Monte sua vitrine, cole o link na bio e receba o pedido pronto no WhatsApp.'
  writeFileSync(
    INDEX,
    inject(shell, {
      title: landingTitle,
      description: landingDesc,
      image: baseAsset('icon-512.png'),
      url: siteUrl ? `${siteUrl}/` : '',
      jsonLd: siteUrl
        ? {
            '@context': 'https://schema.org',
            '@type': 'WebSite',
            name: PRODUCT,
            url: `${siteUrl}/`
          }
        : null
    })
  )

  if (!supabaseUrl || !anonKey) {
    console.warn('[og] Supabase não configurado: pulando páginas de loja e sitemap.')
    return
  }

  async function sb(query) {
    const res = await fetch(`${supabaseUrl}/rest/v1/${query}`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` }
    })
    if (!res.ok) throw new Error(`[og] Supabase ${query} -> ${res.status} ${await res.text()}`)
    return res.json()
  }

  try {
    const [stores, products] = await Promise.all([
      sb('stores?select=id,slug,name,bio,avatar_url,cover_url&order=created_at.desc&limit=5000'),
      sb('products?select=store_id,photo_url&active=eq.true&photo_url=neq.&order=sort.asc&limit=10000')
    ])

    const firstPhoto = {}
    for (const p of products) {
      if (p.store_id && p.photo_url && !firstPhoto[p.store_id]) firstPhoto[p.store_id] = p.photo_url
    }

    let count = 0
    const urls = []
    for (const store of stores) {
      const slug = String(store.slug || '').trim()
      if (!slug) continue
      const dir = path.join(DIST, slug)
      mkdirSync(dir, { recursive: true })

      const url = siteUrl ? `${siteUrl}/${slug}` : ''
      const title = `${store.name} · peça pelo WhatsApp`
      const description = (store.bio || `Faça seu pedido pelo WhatsApp em ${store.name}.`).slice(0, MAX_DESC)
      const image = absolute(store.avatar_url || store.cover_url || firstPhoto[store.id] || '') || baseAsset('icon-512.png')

      const html = inject(shell, {
        title,
        description,
        image,
        url,
        jsonLd: url
          ? {
              '@context': 'https://schema.org',
              '@type': 'Store',
              name: store.name,
              description,
              image,
              url
            }
          : null
      })

      writeFileSync(path.join(dir, 'index.html'), html)
      if (url) urls.push(url)
      count += 1
    }

    if (siteUrl) {
      const entries = [`${siteUrl}/`, ...urls]
      const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries
        .map((u) => `  <url><loc>${esc(u)}</loc></url>`)
        .join('\n')}\n</urlset>\n`
      writeFileSync(path.join(DIST, 'sitemap.xml'), sitemap)
      writeFileSync(
        path.join(DIST, 'robots.txt'),
        `User-agent: *\nAllow: /\nSitemap: ${siteUrl}/sitemap.xml\n`
      )
    }

    console.log(`[og] ${count} página(s) de loja geradas${siteUrl ? ' + sitemap.xml/robots.txt' : ''}.`)
  } catch (err) {
    console.warn('[og] falha ao gerar páginas de loja (deploy segue normalmente):', err.message)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
