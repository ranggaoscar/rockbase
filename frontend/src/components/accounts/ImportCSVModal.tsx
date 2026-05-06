import { useState, useRef } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { FileUp, Download, CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { toast } from '@/components/ui/use-toast'
import api from '@/lib/api'

interface ImportCSVModalProps {
  open: boolean
  onClose: () => void
  onSuccess: () => void
}

export default function ImportCSVModal({ open, onClose, onSuccess }: ImportCSVModalProps) {
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState<{
    successCount: number
    errorCount: number
    errors: string[]
    message: string
  } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0]
    if (selected && selected.type === 'text/csv' || selected?.name.endsWith('.csv')) {
      setFile(selected)
    } else {
      toast.error('Please select a valid CSV file')
    }
  }

  async function handleUpload() {
    if (!file) return
    setUploading(true)
    setResult(null)

    const formData = new FormData()
    formData.append('file', file)

    try {
      const { data } = await api.post('/accounts/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      })
      setResult(data)
      if (data.successCount > 0) {
        toast.success(data.message)
        onSuccess()
      } else {
        toast.error('Import failed — check errors below')
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Failed to upload CSV')
    } finally {
      setUploading(false)
    }
  }

  function downloadTemplate() {
    const csvContent = "username,email,password,platform,brandTag\n" +
                       "anditeknologi,andi@example.com,pass123,Instagram,Brand_A\n" +
                       "budikanebo,budi@example.com,pass456,TikTok,Brand_B"
    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'social_accounts_template.csv'
    a.click()
  }

  function reset() {
    setFile(null)
    setResult(null)
    setUploading(false)
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { onClose(); reset() } }}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileUp className="h-5 w-5 text-purple-400" />
            Import Accounts via CSV
          </DialogTitle>
          <DialogDescription>
            Bulk upload accounts using a CSV file. Use our template for correct formatting.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {!result ? (
            <div 
              className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center gap-3 transition-colors ${file ? 'border-purple-500/50 bg-purple-500/5' : 'border-border hover:border-purple-500/30'}`}
              onClick={() => fileInputRef.current?.click()}
            >
              <input 
                type="file" 
                ref={fileInputRef} 
                className="hidden" 
                accept=".csv" 
                onChange={handleFileChange} 
              />
              <div className="h-12 w-12 rounded-full bg-secondary flex items-center justify-center">
                <FileUp className={`h-6 w-6 ${file ? 'text-purple-400' : 'text-muted-foreground'}`} />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium">{file ? file.name : 'Select CSV File'}</p>
                <p className="text-xs text-muted-foreground mt-1">or drag and drop here</p>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-border p-4 space-y-3 bg-secondary/30">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">Import Summary</span>
                <Badge variant={result.errorCount === 0 ? 'success' : 'warning'}>
                  {result.successCount} OK / {result.errorCount} ERR
                </Badge>
              </div>
              
              {result.errorCount > 0 && (
                <div className="space-y-1.5 max-h-[150px] overflow-y-auto pr-2">
                  {result.errors.map((err, i) => (
                    <div key={i} className="text-[10px] text-red-400 flex items-start gap-1.5">
                      <XCircle className="h-3 w-3 mt-0.5 shrink-0" />
                      <span>{err}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-2 pt-2">
                <CheckCircle2 className="h-4 w-4 text-green-400" />
                <span className="text-xs text-muted-foreground">{result.message}</span>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between">
            <Button 
              variant="link" 
              size="sm" 
              className="text-xs text-purple-400 p-0 h-auto"
              onClick={downloadTemplate}
            >
              <Download className="h-3 w-3 mr-1" /> Download CSV Template
            </Button>
            {result && (
              <Button 
                variant="ghost" 
                size="sm" 
                className="text-xs h-auto"
                onClick={reset}
              >
                Upload another
              </Button>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          {!result && (
            <Button 
              variant="purple" 
              disabled={!file || uploading} 
              onClick={handleUpload}
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <FileUp className="h-4 w-4 mr-2" />}
              Start Import
            </Button>
          )}
          {result && (
            <Button variant="purple" onClick={onClose}>Done</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
