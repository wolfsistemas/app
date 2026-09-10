import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

const RATIOS = [
  ['1:1', 1],
  ['4:3', 4 / 3],
  ['3:4', 3 / 4],
  ['16:9', 16 / 9],
  ['9:16', 9 / 16]
]

const MAX_OUT = 1600

export default function ImageCropper({ src, defaultRatio = '1:1', onCancel, onConfirm }) {
  const stageRef = useRef(null)
  const imgRef = useRef(null)
  const dragRef = useRef(null)
  const [ratioKey, setRatioKey] = useState(
    defaultRatio === 'Original' || RATIOS.some(([k]) => k === defaultRatio) ? defaultRatio : '1:1'
  )
  const [stageW, setStageW] = useState(0)
  const [natural, setNatural] = useState({ w: 0, h: 0 })
  const [scale, setScale] = useState(1)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const ratio =
    ratioKey === 'Original'
      ? natural.w && natural.h
        ? natural.w / natural.h
        : 1
      : RATIOS.find(([k]) => k === ratioKey)[1]
  const stageH = stageW ? stageW / ratio : 0
  const base = natural.w && stageW ? Math.max(stageW / natural.w, stageH / natural.h) : 1
  const zoom = base ? Math.min(3, Math.max(1, scale / base)) : 1
  const ready = Boolean(natural.w && stageW)

  useLayoutEffect(() => {
    function measure() {
      if (stageRef.current) setStageW(stageRef.current.clientWidth)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  const clampPos = useCallback(
    (p, s, n = natural, w = stageW, h = stageH) => ({
      x: Math.min(0, Math.max(w - n.w * s, p.x)),
      y: Math.min(0, Math.max(h - n.h * s, p.y))
    }),
    [natural, stageW, stageH]
  )

  const fit = useCallback(
    (n = natural, w = stageW, h = stageH) => {
      if (!n.w || !w || !h) return
      const b = Math.max(w / n.w, h / n.h)
      setScale(b)
      setPos(clampPos({ x: (w - n.w * b) / 2, y: (h - n.h * b) / 2 }, b, n, w, h))
    },
    [natural, stageW, stageH, clampPos]
  )

  function onImgLoad(e) {
    const n = { w: e.target.naturalWidth, h: e.target.naturalHeight }
    setNatural(n)
    const w = stageRef.current?.clientWidth || stageW
    if (n.w && w) fit(n, w, w / ratio)
  }

  useEffect(() => {
    if (natural.w && stageW) fit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageW, ratioKey, natural.w, natural.h])

  function onPointerDown(e) {
    if (!ready) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { px: e.clientX, py: e.clientY, x: pos.x, y: pos.y }
  }

  function onPointerMove(e) {
    const d = dragRef.current
    if (!d) return
    setPos(clampPos({ x: d.x + (e.clientX - d.px), y: d.y + (e.clientY - d.py) }, scale))
  }

  function onPointerUp() {
    dragRef.current = null
  }

  function onZoom(e) {
    if (!ready) return
    const z = Number(e.target.value)
    const ns = base * z
    const cx = stageW / 2
    const cy = stageH / 2
    const sx = (cx - pos.x) / scale
    const sy = (cy - pos.y) / scale
    setScale(ns)
    setPos(clampPos({ x: cx - sx * ns, y: cy - sy * ns }, ns))
  }

  async function confirm() {
    const img = imgRef.current
    if (!img || !ready) return
    setBusy(true)
    setError('')
    try {
      const sx = -pos.x / scale
      const sy = -pos.y / scale
      const sw = stageW / scale
      const sh = stageH / scale
      const outScale = Math.min(1, MAX_OUT / Math.max(sw, sh))
      const outW = Math.max(1, Math.round(sw * outScale))
      const outH = Math.max(1, Math.round(sh * outScale))
      const canvas = document.createElement('canvas')
      canvas.width = outW
      canvas.height = outH
      const ctx = canvas.getContext('2d')
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH)
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.9))
      if (!blob) throw new Error('Não foi possível gerar a imagem.')
      onConfirm(new File([blob], 'foto.jpg', { type: 'image/jpeg' }))
    } catch (err) {
      setError(err.message || 'Falha ao processar a foto.')
      setBusy(false)
    }
  }

  return (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onCancel() }}>
      <div className="card pad stack modal">
        <div className="between">
          <h3>Ajustar foto</h3>
          <button type="button" className="modal-x" aria-label="Fechar" onClick={onCancel} disabled={busy}>×</button>
        </div>

        <div
          ref={stageRef}
          className="crop-stage"
          style={{ aspectRatio: ratio }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <img
            ref={imgRef}
            className="crop-img"
            src={src}
            alt=""
            draggable={false}
            onLoad={onImgLoad}
            style={{ width: natural.w || 'auto', height: natural.h || 'auto', opacity: natural.w ? 1 : 0, transform: `translate(${pos.x}px, ${pos.y}px) scale(${scale})` }}
          />
        </div>

        <div className="ratio-row">
          {RATIOS.map(([k]) => (
            <button
              key={k}
              type="button"
              className={`btn ${ratioKey === k ? 'btn-dark' : 'btn-ghost'}`}
              onClick={() => setRatioKey(k)}
            >
              {k}
            </button>
          ))}
          <button
            type="button"
            className={`btn ${ratioKey === 'Original' ? 'btn-dark' : 'btn-ghost'}`}
            onClick={() => setRatioKey('Original')}
          >
            Original
          </button>
        </div>

        <div className="zoom-row">
          <span className="tiny muted">Zoom</span>
          <input type="range" min="1" max="3" step="0.02" value={zoom} onChange={onZoom} disabled={!ready} />
        </div>
        <p className="tiny muted">Arraste a foto para enquadrar. A imagem sai recortada no formato escolhido.</p>

        {error && <div className="error">{error}</div>}

        <div className="row">
          <button type="button" className="btn btn-dark" onClick={confirm} disabled={busy || !ready}>
            {busy ? 'Preparando...' : 'Usar foto'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>Cancelar</button>
        </div>
      </div>
    </div>
  )
}
