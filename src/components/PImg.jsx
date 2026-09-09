import React from 'react'

export default function PImg({ src, alt = '', className = '', style = {}, onClick }) {
  if (!src) return null
  return (
    <div
      role="img"
      aria-label={alt}
      className={`pimg ${className}`}
      style={{ backgroundImage: `url("${src}")`, ...style }}
      draggable={false}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      onDragStart={(e) => e.preventDefault()}
      onClick={onClick}
    />
  )
}
