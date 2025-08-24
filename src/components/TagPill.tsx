import React from 'react'

export default function TagPill({ t }: { t: '負傷' | '復帰' | '好調' }) {
  return <span className="badge">{t}</span>
}
