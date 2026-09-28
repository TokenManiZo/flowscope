import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ChevronDown, ChevronUp, Search } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { getRequestLabDraft } from "@/lib/api/endpoints"
import type { RequestLabDraft } from "@/lib/api/types"
import { DATASET_REPLACING } from "@/lib/security/datasetBoundary"
import { highlightRaw, rawTokenClass } from "@/features/evidence/rawHighlight"
import type { SourceFeedItem } from "./SourcePassLayout"

interface RawDraft {
  request: string
  response: string
}

function RawViewer({ label, value, available }: { label: string; value: string; available: boolean }) {
  return <section className="grid min-w-0 content-start gap-2 rounded-lg border border-border/70 bg-background/30 p-3" aria-label={`${label} 원문 패널`}>
    <h3 className="font-medium">{label}</h3>
    {available ? <pre aria-label={`${label} 원문`} className="max-h-[30rem] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/30 p-3 font-mono text-xs">
      {highlightRaw(value).map((tokens, line) => <span key={line}>{tokens.map((token, index) => <span key={index} className={rawTokenClass[token.kind]}>{token.text}</span>)}{"\n"}</span>)}
    </pre> : <div role="status" className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">이 원문은 보존되지 않아 사용할 수 없습니다.</div>}
  </section>
}

function HumanRawDialog({ eventId, open, onOpenChange }: { eventId: string | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const raw = useRef<RawDraft>({ request: "", response: "" })
  const [draft, setDraft] = useState<Omit<RequestLabDraft, "request" | "response"> | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [, setVersion] = useState(0)

  const clear = useCallback(() => {
    raw.current.request = ""
    raw.current.response = ""
    setDraft(null)
    setError("")
    setVersion((value) => value + 1)
  }, [])
  const close = useCallback(() => { clear(); onOpenChange(false) }, [clear, onOpenChange])

  useEffect(() => {
    if (!open || !eventId) return
    const controller = new AbortController()
    clear()
    setLoading(true)
    void getRequestLabDraft(eventId, controller.signal).then((next) => {
      if (controller.signal.aborted) return
      raw.current.request = next.request ?? ""
      raw.current.response = next.response ?? ""
      const { request: _request, response: _response, ...metadata } = next
      setDraft(metadata)
      setVersion((value) => value + 1)
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "원문을 불러오지 못했습니다.")
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => { controller.abort(); raw.current.request = ""; raw.current.response = "" }
  }, [clear, eventId, open])

  useEffect(() => {
    const clearOnUnload = () => { raw.current.request = ""; raw.current.response = "" }
    const closeOnReplacement = () => close()
    window.addEventListener("beforeunload", clearOnUnload)
    window.addEventListener(DATASET_REPLACING, closeOnReplacement)
    return () => { window.removeEventListener("beforeunload", clearOnUnload); window.removeEventListener(DATASET_REPLACING, closeOnReplacement) }
  }, [close])

  return <Dialog open={open} onOpenChange={(next) => next ? onOpenChange(true) : close()}>
    <DialogContent className="max-h-[calc(100svh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-[70rem]" showCloseButton={false}>
      <DialogHeader className="border-b p-5"><DialogTitle>원문 보기</DialogTitle><DialogDescription>서버가 반환한 마스킹 요청과 응답을 읽기 전용으로 표시합니다.</DialogDescription></DialogHeader>
      <div className="min-h-0 overflow-y-auto p-5">
        {loading && <p className="text-sm text-muted-foreground">원문 불러오는 중…</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        {draft && <div className="space-y-4">
          <dl className="grid gap-2 rounded-lg border border-border/70 p-3 text-sm sm:grid-cols-2"><div><dt className="text-muted-foreground">서비스</dt><dd className="break-all font-mono">{draft.service}</dd></div><div><dt className="text-muted-foreground">관측 신원</dt><dd>{draft.observedIdentity || "비로그인"}</dd></div></dl>
          {draft.message && <p className="text-xs text-muted-foreground">{draft.message}</p>}
          <div role="group" aria-label="읽기 전용 요청 및 응답" className="grid min-w-0 gap-4 lg:grid-cols-2">
            <RawViewer label="요청" value={raw.current.request} available={draft.rawRequestRetained} />
            <RawViewer label="응답" value={raw.current.response} available={draft.rawResponseRetained} />
          </div>
        </div>}
      </div>
      <DialogFooter><Button type="button" variant="outline" onClick={close}>닫기</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}

export function HumanRequestFeed({ items, description, emptyHint }: { items: readonly SourceFeedItem[]; description?: string; emptyHint: string }) {
  const [query, setQuery] = useState("")
  const [expanded, setExpanded] = useState(true)
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    if (!normalized) return items
    return items.filter((item) => [item.badge, item.title, item.detail ?? "", item.status].some((value) => value.toLocaleLowerCase().includes(normalized)))
  }, [items, query])

  return <>
    <Card className="overflow-hidden">
      <CardHeader className="border-b">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><CardTitle className="text-base">작업 피드</CardTitle>{description && <CardDescription>{description}</CardDescription>}</div>
          <div className="flex min-w-0 flex-1 items-center justify-end gap-2 sm:flex-none">
            <div className="relative min-w-0 flex-1 sm:w-64"><Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><Input aria-label="HUMAN 작업 피드 검색" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="메서드·경로·신원·상태 검색" className="pl-8" /></div>
            <Button type="button" variant="outline" size="icon" aria-label={expanded ? "작업 피드 접기" : "작업 피드 펼치기"} onClick={() => setExpanded((value) => !value)}>{expanded ? <ChevronUp /> : <ChevronDown />}</Button>
          </div>
        </div>
      </CardHeader>
      {expanded && <CardContent className="p-0"><div className="max-h-96 overflow-y-auto p-3">
        {filtered.length ? <div className="space-y-1">{filtered.map((item) => <Button key={item.id} type="button" variant="ghost" className="h-auto w-full justify-start rounded-md px-2 py-3 text-left" onClick={() => setSelectedEventId(item.id)} aria-label={`${item.badge} ${item.title} ${item.detail ?? ""} HTTP ${item.status} 원문 보기`}><span className="grid w-full grid-cols-[auto_minmax(0,1fr)] gap-3"><Badge variant="outline" className="h-fit">{item.badge}</Badge><span className="min-w-0"><span className="flex flex-wrap justify-between gap-2"><span className="font-medium">{item.title}</span><span className="font-mono text-xs text-muted-foreground">{item.status}</span></span>{item.detail && <span className="block break-all text-sm text-muted-foreground">{item.detail}</span>}</span></span></Button>)}</div> : <p className="py-10 text-center text-sm text-muted-foreground">{items.length ? "검색 결과가 없습니다." : emptyHint}</p>}
      </div></CardContent>}
    </Card>
    <HumanRawDialog eventId={selectedEventId} open={selectedEventId !== null} onOpenChange={(open) => { if (!open) setSelectedEventId(null) }} />
  </>
}