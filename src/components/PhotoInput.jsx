import React, { useState } from 'react'
import { uploadPhoto } from '../lib/upload.js'

export default function PhotoInput({ label, value, onChange, placeholder = 'https://...' }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function onFile(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError('')
    setBusy(true)
    try {
      const url = await uploadPhoto(file)
      onChange(url)
    } catch (err) {
      setError(err.message || 'Não foi possível enviar a foto.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack">
      <label>{label}</label>
      {value ? <img src={value} alt="" style={{ width: 120, height: 120, objectFit: 'cover', borderRadius: 16 }} /> : null}
      <input type="file" accept="image/*" onChange={onFile} disabled={busy} />
      <input
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      <div className="help">{busy ? 'Enviando foto...' : 'Sobe um arquivo ou cola o link. Só o link vai para o banco.'}</div>
      {error && <div className="error">{error}</div>}
    </div>
  )
}
