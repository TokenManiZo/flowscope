import { useRef, useState } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import type { ImportXmlResult } from "@/lib/api/types"
import { ApiError } from "@/lib/api/client"

type ImportSource = "human" | "scanner" | "llm"
type ImportOutcome = { filename: string; result?: ImportXmlResult; error?: string }

type Props = {
  importFile: (source: ImportSource, name: string, xml: string) => Promise<ImportXmlResult>
  afterImport: () => Promise<unknown>
}

function messageFor(error: unknown): string {
  return error instanceof ApiError ? error.message : "XML 가져오기에 실패했습니다."
}

export function ImportXmlDialog({ importFile, afterImport }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [source, setSource] = useState<ImportSource>("human")
  const [files, setFiles] = useState<File[]>([])
  const [active, setActive] = useState(false)
  const [outcomes, setOutcomes] = useState<ImportOutcome[]>([])
  const [validationError, setValidationError] = useState("")

  const totals = outcomes.reduce((total, item) => ({
    imported: total.imported + (item.result?.imported ?? 0),
    candidates: total.candidates + (item.result?.candidates ?? 0),
    failed: total.failed + (item.result?.failed ?? 0),
  }), { imported: 0, candidates: 0, failed: 0 })

  async function submit() {
    if (validationError) return
    if (files.length === 0) {
      setValidationError("가져올 XML 파일을 하나 이상 선택하세요.")
      return
    }
    setActive(true)
    setValidationError("")
    const next: ImportOutcome[] = []
    for (const file of files) {
      try {
        const xml = await file.text()
        next.push({ filename: file.name, result: await importFile(source, file.name, xml) })
      } catch (error) {
        next.push({ filename: file.name, error: messageFor(error) })
      }
    }
    setOutcomes(next)
    try {
      if (next.some((item) => item.result !== undefined)) {
        await afterImport()
        setFiles([])
        if (inputRef.current) inputRef.current.value = ""
      }
    } finally {
      setActive(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!active) setOpen(next) }}>
      <DialogTrigger asChild><Button>XML 가져오기</Button></DialogTrigger>
      <DialogContent aria-describedby="xml-import-description">
        <DialogHeader>
          <DialogTitle>XML 가져오기</DialogTitle>
          <DialogDescription id="xml-import-description">XML 원문은 저장하지 않습니다.</DialogDescription>
        </DialogHeader>
        <label className="grid gap-1" htmlFor="xml-source">가져올 출처
          <select id="xml-source" aria-label="가져올 출처" value={source} onChange={(event) => setSource(event.target.value as ImportSource)} disabled={active}>
            <option value="human">사람</option><option value="scanner">스캐너</option><option value="llm">LLM</option>
          </select>
        </label>
        <label className="grid gap-1" htmlFor="xml-files">XML 파일 선택
          <Input ref={inputRef} id="xml-files" aria-label="XML 파일 선택" type="file" accept=".xml,application/xml,text/xml" multiple disabled={active}
            onChange={(event) => {
              const selected = Array.from(event.target.files ?? [])
              const hasUnsupported = selected.some((file) => !file.name.toLowerCase().endsWith(".xml"))
              setFiles(hasUnsupported ? [] : selected)
              setOutcomes([])
              setValidationError(hasUnsupported ? "XML 파일만 선택하세요." : "")
            }} />
        </label>
        {validationError && <Alert variant="destructive"><AlertTitle>가져오기 확인</AlertTitle><AlertDescription>{validationError}</AlertDescription></Alert>}
        {outcomes.length > 0 && <div className="grid gap-2" aria-live="polite">
          <Alert><AlertTitle>가져오기 결과</AlertTitle><AlertDescription>가져옴 {totals.imported} · 응답 없음 {totals.candidates} · 실패 {totals.failed}</AlertDescription></Alert>
          {outcomes.filter((item) => item.error).map((item) => <Alert key={item.filename} variant="destructive"><AlertDescription>{item.filename}: {item.error}</AlertDescription></Alert>)}
        </div>}
        <DialogFooter><Button onClick={() => void submit()} disabled={active}>{active ? "XML 가져오는 중" : "XML 가져오기 실행"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
