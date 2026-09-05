import React, { useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import Nav from '../components/Nav.jsx'
import { useAuth } from '../lib/AuthContext.jsx'
import { formatPhone, onlyDigits, publicUrl, RESERVED_SLUGS, slugify, uid } from '../lib/format.js'
import { localDb } from '../lib/local.js'
import { isSupabase, supabase } from '../lib/supabase.js'

export default function Onboarding() {
  const { user, store, saveStore } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState({
    name: '',
    slug: '',
    whatsapp: '',
    bio: 'Peças selecionadas. Pedido pelo WhatsApp.',
    pix_key: '',
    instagram: '',
    theme: 'bosque'
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const previewSlug = useMemo(() => slugify(form.slug || form.name), [form.slug, form.name])

  if (store) return <Navigate to="/painel" replace />

  async function slugTaken(slug) {
    if (!slug || RESERVED_SLUGS.includes(slug)) return true
    if (isSupabase) {
      const { data } = await supabase.from('stores').select('id').eq('slug', slug).maybeSingle()
      return Boolean(data)
    }
    return localDb.slugTaken(slug)
  }

  async function onSubmit(e) {
    e.preventDefault()
    setError('')
    const slug = previewSlug
    if (!slug) {
      setError('Escolha um nome para gerar o link.')
      return
    }
    setBusy(true)
    try {
      if (await slugTaken(slug)) {
        setError('Esse link já está em uso. Tente outro.')
        setBusy(false)
        return
      }
      await saveStore({
        slug,
        name: form.name.trim(),
        bio: form.bio,
        whatsapp: onlyDigits(form.whatsapp),
        pix_key: form.pix_key || '',
        instagram: form.instagram.replace('@', ''),
        theme: form.theme,
        avatar_url: '',
        cover_url: '',
        plan: 'free',
        links: form.instagram
          ? [{ id: uid('link'), label: 'Instagram', url: `https://instagram.com/${form.instagram.replace('@', '')}` }]
          : []
      })
      navigate('/painel')
    } catch (err) {
      setError(err.message || 'Não foi possível criar a loja.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Nav />
      <main className="wrap" style={{ padding: '32px 0', maxWidth: 640 }}>
        <div className="card pad stack">
          <h2>Sua loja em 1 minuto</h2>
          <p>Depois você sobe as fotos. Agora só o essencial para o link existir.</p>
          <form className="form" onSubmit={onSubmit}>
            <label>Nome da loja</label>
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value, slug: form.slug || slugify(e.target.value) })}
              placeholder="Ana Ateliê"
            />
            <label>Link</label>
            <input
              required
              value={form.slug}
              onChange={(e) => setForm({ ...form, slug: slugify(e.target.value) })}
              placeholder="ana-atelier"
            />
            <div className="help">{previewSlug ? publicUrl(previewSlug) : 'o link aparece aqui'}</div>
            <label>WhatsApp que recebe o pedido</label>
            <input
              required
              value={formatPhone(form.whatsapp)}
              onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
              placeholder="(11) 99999-0000"
            />
            <label>Instagram (opcional)</label>
            <input
              value={form.instagram}
              onChange={(e) => setForm({ ...form, instagram: e.target.value })}
              placeholder="@ana.atelier"
            />
            <label>Frase da bio</label>
            <textarea value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} />
            <label>Tema</label>
            <select value={form.theme} onChange={(e) => setForm({ ...form, theme: e.target.value })}>
              <option value="bosque">Bosque</option>
              <option value="areia">Areia</option>
              <option value="rosa">Rosa</option>
              <option value="noite">Noite</option>
            </select>
            {error && <div className="error">{error}</div>}
            <button className="btn btn-dark" disabled={busy}>{busy ? 'Criando...' : 'Gerar meu link'}</button>
          </form>
        </div>
      </main>
    </>
  )
}
