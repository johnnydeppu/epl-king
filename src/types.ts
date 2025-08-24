export type Trust = 'bbc' | 'sky' | 'official' | 'other'
export type Tag = '負傷' | '復帰' | '好調'

export interface TeamRef { id: string; name: string }
export interface MatchInfo {
  id: string
  kickoff_jst: string
  home: TeamRef
  away: TeamRef
  hashtag: string
}

export interface Insight {
  id: string
  ts: number
  url: string
  domain: string
  trust: Trust
  tags: Tag[]
  players: string[]
  ja: string
  en?: string
  _score?: number
}

export interface LatestJson {
  match: MatchInfo
  items: Insight[]
}
