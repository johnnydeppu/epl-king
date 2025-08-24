import React from 'react'

export default function ScoreDot({ score }: { score: number }) {
  const size = Math.max(6, Math.round(6 + score * 6))
  const opacity = 0.5 + score * 0.5
  return (
    <div title={`score ${score}`} className="rounded-full bg-gray-900" style={{ width: size, height: size, opacity }} />
  )
}
