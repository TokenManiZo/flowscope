import { useEffect, useRef, useState } from "react"
import { ChevronDown, ChevronRight, CircleHelp, Maximize2, Minimize2, Network, Send } from "lucide-react"
import { HttpStatusBadge, MethodBadge } from "@/components/TrafficBadges"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { stripOrigin, withEvidenceOrdinals, withoutUnnumberedEvidence } from "@/lib/display/operationLabel"
import { identityLabel } from "@/lib/display/identityLabel"
import type { LlmFinding, Snapshot } from "@/lib/api/types"
import { findingService, findingStatus, findingStatusLabel, type FindingStatus } from "./findingResults"

const statusTone: Record<FindingStatus, string> = {
  vulnerable: "border-destructive/50 bg-destructive/10 text-destructive",
  inconclusive: "border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  not_vulnerable: "border-emerald-500/50 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300",
  unjudged: "border-border bg-muted text-muted-foreground",
}
const statusEdge: Record<FindingStatus, string> = {
  vulnerable: "border-l-destructive/60",
  inconclusive: "border-l-amber-500/60",
  not_vulnerable: "border-l-emerald-500/60",
  unjudged: "",
}
function InfoHelp({ label, children }: { label: string; children: string }) {
  return <Popover><PopoverTrigger asChild><button type="button" aria-label={`${label} 도움말`} className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"><CircleHelp className="size-4" aria-hidden="true" /></button></PopoverTrigger><PopoverContent align="start" className="w-72 text-xs leading-relaxed" aria-label={`${label} 설명`}>{children}</PopoverContent></Popover>
}

interface Props {
  finding: LlmFinding
  snapshot: Snapshot | undefined
  enlarged: boolean
  picked: boolean
  selectable: boolean
  excluded?: boolean
  disabled: boolean
  onEnlarge(): void
  onCloseEnlarged(): void
  onPick(value: boolean): void
  onOpenRequest(evidenceId: string): void
  onOpenGraph(evidenceId: string): void
}

export function FindingResultCard({ finding, snapshot, enlarged, picked, selectable, excluded = false, disabled,
  onEnlarge, onCloseEnlarged, onPick, onOpenRequest, onOpenGraph }: Props) {
  const [fullView, setFullView] = useState(false)
  const articleRef = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!fullView) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setFullView(false); return }
      if (event.key !== "Tab") return
      const controls = [...(articleRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [])]
      if (controls.length === 0) return
      const first = controls[0]
      const last = controls[controls.length - 1]
      if (event.shiftKey && (document.activeElement === first || !articleRef.current?.contains(document.activeElement))) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && (document.activeElement === last || !articleRef.current?.contains(document.activeElement))) { event.preventDefault(); first.focus() }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("keydown", onKeyDown) }
  }, [fullView])
  useEffect(() => { if (!enlarged) setFullView(false) }, [enlarged])
  const evidenceIds = [...new Set([...finding.judgmentEvidenceIds, ...finding.evidenceIds])]
  const replayIds = new Set((snapshot?.manualVerifications ?? []).map(item => item.eventId))
  const status = findingStatus(finding)
  const reason = withoutUnnumberedEvidence(withEvidenceOrdinals(finding.judgmentReason || finding.note, snapshot?.evidenceOrdinals))
  const result = finding.verificationResult?.trim() ?? ""
  const basis = finding.judgmentBasis?.trim() ?? ""
  const structuredSummary = status !== "unjudged" && !!result && !!basis
  const reasonFallback = status === "unjudged" ? "아직 소견 설명이 없습니다." : "아직 판정 근거가 없습니다."
  const issueTitle = finding.issueTitle?.trim() || (finding.verdict.length <= 80 ? finding.verdict.trim() : "")
  const service = findingService(finding)
  const operation = stripOrigin(finding.operation) || finding.operation
  const closeDetail = () => { setFullView(false); onCloseEnlarged() }
  const openRequest = (id: string) => { closeDetail(); onOpenRequest(id) }
  const openGraph = (id: string) => { closeDetail(); onOpenGraph(id) }

  const evidenceList = (limit?: number) => <div className="divide-y divide-border/60 border-y border-border/70">
    {evidenceIds.slice(0, limit).map((id, index) => {
      const event = snapshot?.events.find(item => item.eventId === id)
      const replay = replayIds.has(id)
      const ordinal = snapshot?.evidenceOrdinals?.[id]
      return <div key={id} data-evidence-id={id} className="grid gap-3 py-2.5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="flex min-w-0 items-start gap-3">
          <span className="w-8 shrink-0 pt-0.5 text-right font-mono text-xs tabular-nums text-muted-foreground">{ordinal == null ? index + 1 : ordinal}</span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {event ? <><MethodBadge method={event.method} /><span className="min-w-0 break-all font-mono text-xs">{event.path}</span><HttpStatusBadge status={event.status} /></>
                : <span className="text-sm text-muted-foreground">요청 기록을 찾을 수 없습니다.</span>}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 pl-11 lg:pl-0">
          <Button type="button" size="sm" variant="outline" disabled={!event} onClick={() => openRequest(id)}><Send className="size-3.5" />요청·응답 보기</Button>
          {replay && <Button type="button" size="sm" variant="outline" onClick={() => openGraph(id)}><Network className="size-3.5" />재전송 그래프</Button>}
        </div>
      </div>
    })}
    {evidenceIds.length === 0 && <p className="py-4 text-sm text-muted-foreground">연결된 요청 기록이 없습니다.</p>}
  </div>

  return <>
    {fullView && <div className="fixed inset-0 z-40 bg-black/70" aria-hidden="true" onClick={() => setFullView(false)} />}
    <article ref={articleRef} data-finding-id={finding.id} role={fullView ? "dialog" : undefined} aria-modal={fullView ? true : undefined} aria-label={fullView ? `${operation} ${status === "unjudged" ? "소견 상세" : "판정 상세"}` : undefined} className={`overflow-hidden rounded-lg border border-border/80 bg-background ${statusEdge[status]} ${fullView ? "fixed inset-x-4 top-1/2 z-50 max-h-[calc(100vh-2rem)] -translate-y-1/2 overflow-y-auto shadow-2xl md:inset-x-8" : ""}`}>
    <div className={`flex items-center gap-3 ${fullView ? "border-b bg-muted/20 px-6 py-5" : "px-4 py-3"}`}>
      {selectable && <Checkbox aria-label={`${finding.operation} 판정 선택`} checked={picked} disabled={disabled || excluded} onCheckedChange={value => onPick(value === true)} />}
      <button type="button" className="flex min-w-0 flex-1 items-center gap-3 rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`${operation} ${enlarged ? "상세 접기" : "상세 펼치기"}`} aria-expanded={enlarged} aria-controls={`finding-detail-${finding.id}`} onClick={fullView ? () => setFullView(false) : enlarged ? closeDetail : onEnlarge}>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className={`min-w-0 break-words font-medium ${fullView ? "text-lg" : ""}`}>{operation}</span>
          <span className={`rounded border px-2 py-0.5 text-xs font-medium ${statusTone[status]}`}>{findingStatusLabel[status]}</span>
          {excluded && <span className="rounded border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground" title="판정 매트릭스의 제외한 항목에서 복원할 수 있습니다.">LLM 검사 제외</span>}
        </span>
        {issueTitle && <span className="mt-1 block truncate text-sm font-medium text-foreground/85">{issueTitle}</span>}
        <span className="mt-1 block truncate text-xs text-muted-foreground">{service && `${service} · `}{identityLabel(finding.identity)}</span>
      </span>
      {enlarged ? <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
      </button>
      {fullView && <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={() => setFullView(false)}><Minimize2 className="size-3.5" />원래 크기로</Button>}
    </div>
    {enlarged && <div id={`finding-detail-${finding.id}`} className={`${fullView ? "px-6 py-5" : "border-t border-border/70 px-5 py-4"}`}>
          <div className="grid gap-5">
            <section aria-label={status === "unjudged" ? "소견 요약" : "판정 요약"} className={`grid gap-2 ${fullView ? "rounded-lg border bg-muted/20 p-5" : ""}`}>
              <div className="flex items-center justify-between gap-3"><h3 className="text-base font-semibold">{status === "unjudged" ? "소견 요약" : "판정 요약"}</h3>{!fullView && <Button type="button" size="sm" variant="outline" className="shrink-0" onClick={() => setFullView(true)}><Maximize2 className="size-3.5" />{evidenceIds.length > 3 ? `요청 ${evidenceIds.length}건 모두 보기` : "전체 보기"}</Button>}</div>
              {structuredSummary ? <ol className="grid gap-2 text-sm leading-6">
                <li className="grid gap-1 sm:grid-cols-[7rem_minmax(0,1fr)]"><strong className="font-semibold text-muted-foreground">1. 검증 결과</strong><span className="break-words">{result}</span></li>
                <li className="grid gap-1 sm:grid-cols-[7rem_minmax(0,1fr)]"><strong className="font-semibold text-muted-foreground">2. 판정 근거</strong><span className="break-words">{basis}</span></li>
              </ol> : <p className="max-w-[75ch] whitespace-pre-wrap break-words text-base font-medium leading-7">{reason || reasonFallback}</p>}
              {fullView && structuredSummary && reason && <details className="border-t pt-3 text-sm"><summary className="cursor-pointer text-muted-foreground">상세 분석</summary><p className="mt-2 whitespace-pre-wrap break-words leading-6">{reason}</p></details>}
            </section>
            {fullView && <dl className="grid gap-4 border-y py-4 text-sm sm:grid-cols-3">
              <div><dt className="text-xs text-muted-foreground">대상 서비스</dt><dd className="mt-1 break-all font-medium">{service || "알 수 없음"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">검사 계정</dt><dd className="mt-1 break-all font-medium">{identityLabel(finding.identity)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">{finding.judgedAt > 0 ? "판정 시각" : "연결된 요청"}</dt><dd className="mt-1 font-medium tabular-nums">{finding.judgedAt > 0 ? new Date(finding.judgedAt).toLocaleString("ko-KR") : `${evidenceIds.length}건`}</dd></div>
            </dl>}
            <section aria-label="요청 근거" className="grid gap-2">
              <div><div className="flex items-center gap-1"><h3 className="text-base font-semibold">요청 근거 <span className="font-normal tabular-nums text-muted-foreground">{evidenceIds.length}건</span></h3><InfoHelp label="요청 근거">요청·응답 보기를 누르면 실제 요청과 응답 원문을 확인할 수 있습니다. 재전송된 기록은 그래프에서도 확인할 수 있습니다.</InfoHelp></div><p className="mt-1 text-xs text-muted-foreground">아래는 이 소견을 찾거나 판정할 때 사용한 실제 요청입니다.</p></div>
              {evidenceList(fullView ? undefined : 3)}
            </section>
          </div>
    </div>}
  </article>
  </>
}
