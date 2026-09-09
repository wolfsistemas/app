import React, { useState } from 'react'
import { uploadPhoto } from '../lib/upload.js'

export default function PhotoInput({ label, value, onChange }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [pasteOpen, setPasteOpen] = useState(false)

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
      {value && (
        <div className="photo-thumb">
          <img src={value} alt="" />
          <button
            type="button"
            className="photo-remove"
            aria-label="Remover foto"
            title="Remover foto"
            onClick={() => onChange('')}
          >
            ×
          </button>
        </div>
      )}
      <div className="photo-picker">
        <label className="btn btn-ghost" style={{ cursor: busy ? 'wait' : 'pointer' }}>
          {busy ? 'Enviando...' : value ? 'Trocar foto' : 'Adicionar foto'}
          <input type="file" accept="image/*" onChange={onFile} disabled={busy} style={{ display: 'none' }} />
        </label>
        <button type="button" className="btn btn-ghost" onClick={() => setPasteOpen((v) => !v)}>
          {pasteOpen ? 'Ocultar link' : 'Usar link'}
        </button>
      </div>
      {pasteOpen && (
        <input value={value || ''} onChange={(e) => onChange(e.target.value)} placeholder="https://" autoFocus />
      )}
      <div className="help">{busy ? 'Enviando foto...' : 'Sobe um arquivo do seu aparelho.'}</div>
      {error && <div className="error">{error}</div>}
    </div>
  )
}
