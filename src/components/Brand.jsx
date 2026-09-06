import React, { useState } from 'react'
import { Link } from 'react-router-dom'

const logoSrc = `${import.meta.env.BASE_URL}logo.png`

export default function Brand({ to = '/', onDark = false }) {
  const [imgOk, setImgOk] = useState(true)
  return (
    <Link to={to} className={`brand${onDark ? ' on-dark' : ''}`}>
      {imgOk ? (
        <img className="logo-img" src={logoSrc} alt="" onError={() => setImgOk(false)} />
      ) : (
        <span className="logo">V</span>
      )}
      VitrineZap
    </Link>
  )
}
