import React from 'react'
import type { Trust } from '../types'

export default function TrustBadge({ trust }: { trust: Trust }) {
  const label = trust === 'bbc' ? 'BBC' : trust === 'sky' ? 'Sky' : trust === 'official' ? 'Official' : 'Other'
  return <span className="badge">{label}</span>
}
