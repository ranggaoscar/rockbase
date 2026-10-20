import type { LucideIcon } from 'lucide-react'
import {
  Activity, BookOpenText, ClipboardCheck, Compass, Gauge, Globe2, Heart, KeyRound, Leaf, ListChecks,
  MonitorSmartphone, Network, PenLine, Radar, SendHorizontal, Settings, Sparkles, Sunrise, Target, Users, Wrench,
} from 'lucide-react'

/**
 * RockBase information architecture.
 *
 * Six work "places" follow how growth work is actually thought about
 * (discover → analyze → create → publish → measure), plus Setup for the
 * plumbing that supports them. Every legacy route keeps working; it is simply
 * filed under the place it belongs to, so deep links never break.
 */
export type Availability = 'all' | 'local'
export interface NavLeaf { label: string; path: string; icon: LucideIcon; hint?: string; availability?: Availability; keywords?: string }
export interface NavPlace extends NavLeaf { id: string; verb: string; children?: NavLeaf[]; match: string[] }

export const isLocalMode = import.meta.env.VITE_ROCKBASE_MODE === 'local'

export const places: NavPlace[] = [
  { id: 'today', label: 'Today', verb: 'Start', path: '/', icon: Sunrise, match: ['/'], hint: 'What is worth doing next' },
  {
    id: 'radar', label: 'Radar', verb: 'Discover', path: '/trends', icon: Radar, match: ['/trends'], availability: 'local',
    hint: 'Topics with evidence for this brand', keywords: 'trend radar discover topics ideas',
  },
  {
    id: 'search', label: 'Site & Search', verb: 'Analyze', path: '/seo', icon: Globe2, match: ['/seo'],
    hint: 'Technical health and Google performance', keywords: 'seo crawl scan gsc search console keywords',
    children: [{ label: 'Competitors', path: '/seo?tab=competitors', icon: Compass, hint: 'Public website evidence' }],
  },
  {
    id: 'studio', label: 'Studio', verb: 'Create', path: '/studio', icon: PenLine, match: ['/studio', '/ai-writer'],
    hint: 'Every draft, brief and caption', keywords: 'drafts content briefs articles captions writer',
    children: [
      { label: 'Library', path: '/studio', icon: BookOpenText },
      { label: 'Caption assistant', path: '/ai-writer', icon: Sparkles, hint: 'Optional AI' },
    ],
  },
  {
    id: 'publish', label: 'Publish', verb: 'Distribute', path: '/publish', icon: SendHorizontal,
    match: ['/publish', '/compose', '/campaigns', '/queue', '/activity'],
    hint: 'Posts, campaigns and the queue', keywords: 'compose post campaign queue activity social',
    children: [
      { label: 'Overview', path: '/publish', icon: Compass },
      { label: 'Quick post', path: '/compose', icon: SendHorizontal },
      { label: 'Campaigns', path: '/campaigns', icon: Target },
      { label: 'Queue', path: '/queue', icon: ListChecks },
      { label: 'Activity', path: '/activity', icon: Activity },
    ],
  },
  {
    id: 'results', label: 'Results', verb: 'Measure', path: '/results', icon: Gauge, match: ['/results', '/analytics'],
    hint: 'What is actually measured, with source and period', keywords: 'results analytics measure performance',
  },
]

export const setupPlace: NavPlace = {
  id: 'setup', label: 'Setup', verb: 'Connect', path: '/setup', icon: Wrench,
  match: ['/setup', '/accounts', '/farm', '/proxies', '/warming', '/engagement', '/validation', '/settings'],
  hint: 'Connections, accounts and operations',
  children: [
    { label: 'Overview', path: '/setup', icon: Wrench },
    { label: 'Google', path: '/setup/google', icon: KeyRound, availability: 'local', keywords: 'gsc search console connect oauth' },
    { label: 'Accounts', path: '/accounts', icon: Users },
    { label: 'Sessions', path: '/farm', icon: MonitorSmartphone, keywords: 'farm view session control recovery' },
    { label: 'Proxies', path: '/proxies', icon: Network },
    { label: 'Warming', path: '/warming', icon: Leaf },
    { label: 'Engagement', path: '/engagement', icon: Heart },
    { label: 'Ops tools', path: '/validation', icon: ClipboardCheck, keywords: 'operational validation tools' },
    { label: 'Settings', path: '/settings', icon: Settings },
  ],
}

export const allPlaces = [...places, setupPlace]

export function placeFor(pathname: string): NavPlace | undefined {
  if (pathname === '/') return places[0]
  return allPlaces.find((place) => place.id !== 'today' && place.match.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)))
}

export function leafActive(path: string, pathname: string) {
  if (path === '/') return pathname === '/'
  return pathname === path || pathname.startsWith(`${path}/`)
}
