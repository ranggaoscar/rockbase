import { useRef, useState } from 'react'
import { X, Upload, FileText, RefreshCw, AlertCircle, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/use-toast'
import { cn } from '@/lib/utils'
import api from '@/lib/api'

interface Props {
  open: boolean
  onClose: () => void
  onSuccess: () => void
}

// Expected CSV columns:
// scheduledAt (ISO or YYYY-MM-DD HH:mm), content, accountIds (semicolon separated), mediaUrls (optional), recurrence (optional)

function parseCSV(raw: string): any[] {
  const lines = raw.trim().split('\n').filter(Boolean)
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''))
  return lines.slice(1).map(line => {
    // Handle quoted fields
    const cols: string[] = []
    let inQuote = false, cur = ''
    for (const ch of line) {
      if (ch === '"') { inQuote = !inQuote }
      else if (ch === ',' && !inQuote) { cols.push(cur); cur = '' }
      else { cur += ch }
    }
    cols.push(cur)
    const obj: Record<string, any> = {}
    headers.forEach((h, i) => { obj[h] = (cols[i] ?? '').trim().replace(/"/g, '') })
    // Parse accountIds as semicolon-separated
    if (obj.accountids) {
      obj.accountIds = obj.accountids.split(';').map((s: string) => s.trim()).filter(Boolean)
      delete obj.accountids
    }
    // Normalize scheduledAt
    if (obj.scheduledat) { obj.scheduledAt = obj.scheduledat; delete obj.scheduledat }
    if (obj.mediaurls) { obj.mediaUrls = obj.mediaurls.split(';').filter(Boolean); delete obj.mediaurls }
    return obj
  })
}

const SAMPLE_CSV = `scheduledAt,content,accountIds,mediaUrls,recurrence
2026-05-10 09:00,Marmer premium terbaik! #marmer #granite,1;2,,none
2026-05-11 10:00,Granit pilihan terpercaya #granit,2;7,,daily
2026-05-12 14:00,Batu alam natural look 🪨 #batualam,4,,none`

export default function BulkScheduleModal({ open, onClose, onSuccess }: Props) {
  const [csvText, setCsvText]       = useState('')
  const [parsed, setParsed]         = useState<any[]>([])
  const [importing, setImporting]   = useState(false)
  const [results, setResults]       = useState<{ created: number; errors: any[] } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      setCsvText(text)
      setParsed(parseCSV(text))
    }
    reader.readAsText(file)
  }

  function handleTextChange(text: string) {
    setCsvText(text)
    setParsed(parseCSV(text))
  }

  async function handleImport() {
    if (parsed.length === 0) { toast.error('No valid rows to import'); return }
    setImporting(true)
    try {
      const { data } = await api.post<{ created: number; errors: any[] }>('/scheduler/bulk-import', { posts: parsed })
      setResults(data)
      if (data.errors.length === 0) {
        toast.success(`Imported ${data.created} schedules`)
        onSuccess()
      } else {
        toast.warning(`${data.created} created · ${data.errors.length} failed`)
      }
    } catch {
      toast.error('Import failed')
    } finally {
      setImporting(false)
    }
  }

  function handleClose() {
    setCsvText('')
    setParsed([])
    setResults(null)
    onClose()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleClose} />
      <div className="relative z-10 w-full max-w-2xl bg-card border border-border rounded-2xl shadow-2xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-purple-400" />
            <h2 className="font-semibold">Bulk Schedule Import</h2>
          </div>
          <button onClick={handleClose} className="text-muted-foreground hover:text-foreground rounded-lg p-1 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto flex-1">

          {/* Format info */}
          <div className="rounded-lg bg-purple-500/10 border border-purple-500/20 p-3 text-xs text-muted-foreground space-y-1">
            <p className="font-semibold text-purple-300">CSV Format</p>
            <p>Columns: <code className="text-purple-300">scheduledAt, content, accountIds, mediaUrls, recurrence</code></p>
            <p><code className="text-purple-300">accountIds</code> — semicolon-separated IDs (e.g. <code>1;2;7</code>)</p>
            <p><code className="text-purple-300">scheduledAt</code> — e.g. <code>2026-05-10 09:00</code> (WIB)</p>
          </div>

          {/* File upload */}
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
              <FileText className="h-3.5 w-3.5" /> Upload CSV
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground text-xs"
              onClick={() => handleTextChange(SAMPLE_CSV)}
            >
              Load sample
            </Button>
          </div>
          <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleFile} />

          {/* Textarea */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Paste CSV content</span>
              {parsed.length > 0 && (
                <span className="text-xs text-green-400">{parsed.length} rows parsed</span>
              )}
            </div>
            <textarea
              value={csvText}
              onChange={(e) => handleTextChange(e.target.value)}
              placeholder={SAMPLE_CSV}
              rows={8}
              className="w-full rounded-lg border border-border bg-secondary px-3 py-2 text-xs font-mono resize-none focus:outline-none focus:ring-1 focus:ring-purple-500"
            />
          </div>

          {/* Preview table */}
          {parsed.length > 0 && (
            <div className="rounded-lg border border-border overflow-hidden">
              <div className="bg-secondary/50 px-3 py-2 text-xs font-semibold text-muted-foreground border-b border-border">
                Preview (first 5 rows)
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left px-3 py-2 text-muted-foreground font-medium">Date/Time</th>
                      <th className="text-left px-3 py-2 text-muted-foreground font-medium">Caption</th>
                      <th className="text-left px-3 py-2 text-muted-foreground font-medium">Accounts</th>
                      <th className="text-left px-3 py-2 text-muted-foreground font-medium">Repeat</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.slice(0, 5).map((row, i) => (
                      <tr key={i} className="border-b border-border last:border-0">
                        <td className="px-3 py-2 font-mono whitespace-nowrap">{row.scheduledAt}</td>
                        <td className="px-3 py-2 max-w-[200px] truncate">{row.content}</td>
                        <td className="px-3 py-2 text-purple-400">{Array.isArray(row.accountIds) ? row.accountIds.join(', ') : row.accountIds}</td>
                        <td className="px-3 py-2 text-muted-foreground">{row.recurrence || 'none'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Import results */}
          {results && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="h-4 w-4 text-green-400" />
                <span>{results.created} schedules created</span>
                {results.errors.length > 0 && (
                  <span className="text-red-400 flex items-center gap-1">
                    <AlertCircle className="h-3.5 w-3.5" /> {results.errors.length} failed
                  </span>
                )}
              </div>
              {results.errors.map((e, i) => (
                <div key={i} className="text-xs text-red-400 bg-red-500/10 rounded px-3 py-2">
                  Row {e.row}: {e.error}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 p-5 border-t border-border shrink-0">
          <Button variant="ghost" onClick={handleClose}>Close</Button>
          <Button
            variant="purple"
            onClick={handleImport}
            disabled={importing || parsed.length === 0}
          >
            {importing
              ? <><RefreshCw className="h-4 w-4 animate-spin" /> Importing…</>
              : `Import ${parsed.length} Schedules`
            }
          </Button>
        </div>
      </div>
    </div>
  )
}
