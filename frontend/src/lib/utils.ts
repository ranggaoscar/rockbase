import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toString()
}

export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Jakarta',
  }).format(new Date(date))
}

export function formatDateTime(date: string | Date): string {
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Jakarta',
  }).format(new Date(date))
}

export function timeAgo(date: string | Date): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function platformColor(platform: string): string {
  switch (platform.toLowerCase()) {
    case 'instagram': return 'from-pink-500 to-orange-400'
    case 'tiktok': return 'from-cyan-400 to-black'
    default: return 'from-gray-500 to-gray-700'
  }
}

export function statusColor(status: string): string {
  switch (status) {
    case 'active':     return 'text-green-400'
    case 'idle':       return 'text-yellow-400'
    case 'error':
    case 'flagged':    return 'text-red-400'
    case 'warming_up': return 'text-purple-400'
    default:           return 'text-gray-500'
  }
}

export function statusLabel(status: string): string {
  switch (status) {
    case 'active':     return 'Active'
    case 'idle':       return 'Idle'
    case 'error':      return 'Error'
    case 'flagged':    return 'Flagged'
    case 'warming_up': return 'Warming Up'
    case 'logged_out': return 'Logged Out'
    default:           return status
  }
}
