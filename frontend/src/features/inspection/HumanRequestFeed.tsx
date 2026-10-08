export { statusTone } from "@/components/TrafficBadges"
import { HttpStatusBadge, MethodBadge } from "@/components/TrafficBadges"
import { useMemo, useState, type ReactNode } from "react"
import { ChevronDown, ChevronUp, Search } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { highlightRaw, rawTokenClass } from "@/features/evidence/rawHighlight"
import type { SourceFeedItem } from "./SourcePassLayout"
import { RecordViewButton, type RecordView } from "./RecordView"

export function RawViewer({ label, value, available }: { label: string; value: string; available: boolean }) {
  return <section className="grid min-w-0 content-start gap-2 rounded-lg border border-border/70 bg-background/30 p-3" aria-label={`${label} 원문 패널`}>
    <h3 className="font-medium">{label}</h3>
    {available ? <pre aria-label={`${label} 원문`} className="max-h-[30rem] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/30 p-3 font-mono text-xs">
      {highlightRaw(value).map((tokens, line) => <span key={line}>{tokens.map((token, index) => <span key={index} className={rawTokenClass[token.kind]}>{token.text}</span>)}{"\n"}</span>)}
    </pre> : <div role="status" className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">이 원문은 보존되지 않아 사용할 수 없습니다.</div>}
  </section>
}

const FEED_COLUMNS = "grid grid-cols-[3.5rem_4.5rem_minmax(0,1fr)_7rem_3.5rem_5rem] items-center gap-3"

/** 기록된 요청을 열이 고정된 표로 보여 준다(메서드·경로·계정·상태·시각). 행을 누르면 그 기록을 Request Lab으로 연다. */
export function HumanRequestFeed({ items, onOpenRecord, description, emptyHint, title = "기록된 요청", titleBadge, titleControl, showCount = false, showAll = false, searchLabel = "HUMAN 요청 목록 검색", view, context, showSource = false }: { items: readonly SourceFeedItem[]; onOpenRecord(eventId: string): void; description?: string; emptyHint: string; title?: string; titleBadge?: string; titleControl?: ReactNode; showCount?: boolean; showAll?: boolean; searchLabel?: string; view?: RecordView; context?: string; showSource?: boolean }) {
  const columns = showSource ? "grid min-w-[920px] grid-cols-[3.5rem_4.5rem_minmax(12rem,1fr)_3rem_10rem_7rem_3.5rem_5rem] items-center gap-3" : FEED_COLUMNS
  const [source, setSource] = useState("전체")
  const [query, setQuery] = useState("")
  const [expanded, setExpanded] = useState(true)
  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase()
    // 출처·검색을 먼저 적용해야 다른 출처의 새 기록이 기존 Human 기록을 밀어내지 않는다.
    const matching = items.filter((item) => (source === "전체" || item.sourceLabel === source) && (!normalized || [item.ordinal ?? item.id, item.badge, item.title, item.detail ?? "", item.status, item.sourceLabel ?? ""].some((value) => value.toLocaleLowerCase().includes(normalized))))
    return showAll ? matching : matching.slice(0, 200)
  }, [items, query, source, showAll])

  return <Card className={`flex flex-col gap-0 overflow-hidden py-0 ${expanded ? "min-h-32 flex-1" : "shrink-0"}`}>
      <CardHeader className="shrink-0 border-b py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><div className="flex flex-wrap items-center gap-2"><CardTitle className="text-base">{title}</CardTitle>{titleBadge && <Badge variant="outline">{titleBadge}</Badge>}{showCount && <span aria-label={`${title} 건수`} className="text-xs tabular-nums text-muted-foreground">{items.length}건</span>}</div>{view?.focused && <p className="mt-1 text-xs text-muted-foreground">{context} · {showAll ? "전체 저장 기록" : "최근 저장 기록 최대 200건"}</p>}{description && <CardDescription>{description}</CardDescription>}</div>
          <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2 sm:flex-none">{titleControl}
            <div className="relative min-w-0 flex-1 sm:w-64"><Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" /><Input aria-label={searchLabel} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="#번호, 메서드, 경로, 계정, 상태 검색" className="pl-8" /></div>
            {view && <RecordViewButton view={view} onExpand={() => setExpanded(true)} />}
            <Button type="button" variant="outline" size="icon" aria-label={expanded ? "요청 목록 접기" : "요청 목록 펼치기"} onClick={() => setExpanded((value) => !value)}>{expanded ? <ChevronUp /> : <ChevronDown />}</Button>
          </div>
        </div>
      </CardHeader>
      {showSource && <div aria-label="수집 출처 필터" className="flex shrink-0 flex-wrap gap-1 border-b px-4 py-2">{["전체", "사람", "ZAP", ...(items.some((item) => item.sourceLabel === "스캐너") ? ["스캐너"] : []), "LLM", "비로그인으로 자동 재전송"].map(label => <Button key={label} size="sm" variant={source === label ? "secondary" : "ghost"} aria-pressed={source === label} onClick={() => setSource(label)}>{label}</Button>)}</div>}
      {expanded && <CardContent className="flex min-h-0 flex-1 flex-col overflow-x-auto p-0">
        <div className={`${columns} bg-muted/60 px-4 py-2 text-xs text-muted-foreground`} aria-hidden="true"><span>#</span><span>Method</span><span>API</span>{showSource && <><span className="text-center">출처</span><span className="text-center">수집 방식</span></>}<span>계정</span><span>상태</span><span className="text-center">시각</span></div>
        <div data-record-list aria-label="기록된 요청 목록" className={`${showSource ? "min-w-[920px] " : ""}min-h-0 flex-1 overflow-auto`}>
          {filtered.length ? filtered.map((item) => <button key={item.id} type="button" onClick={() => onOpenRecord(item.id)} aria-label={`${item.badge} ${item.title} ${item.detail ?? ""} HTTP ${item.status} Request Lab에서 열기`}
            className={`${columns} w-full border-t border-border px-4 py-2 text-left text-sm first:border-t-0 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none`}>
            <span className="truncate font-mono text-xs text-muted-foreground" title={item.id}>{item.ordinal ?? "—"}</span>
            <MethodBadge method={item.badge} />
            <span className="truncate font-mono text-xs" title={item.title}>{item.title}</span>
            {showSource && <><span className="truncate text-center text-xs text-foreground" title={item.sourceLabel}>{item.sourceCode ?? (item.sourceLabel === "사람" ? "H" : item.sourceLabel === "ZAP" ? "S" : item.sourceLabel === "LLM" ? "L" : "—")}</span><span className="truncate text-center text-xs" title={item.sourceLabel}>{item.sourceLabel}</span></>}
            <span className={`truncate ${item.mutedDetail ? "text-muted-foreground" : ""}`} title={item.detail}>{item.detail}</span>
            <HttpStatusBadge status={item.status} />
            <span className="text-center font-mono text-xs tabular-nums text-muted-foreground">{item.time ?? ""}</span>
          </button>) : <p className="py-10 text-center text-sm text-muted-foreground">{items.length ? "검색 결과가 없습니다." : emptyHint}</p>}
        </div>
      </CardContent>}
      {showCount && expanded && <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t px-4 py-2 text-xs text-muted-foreground"><span>{showAll ? "전체 저장 기록" : "최근 저장 기록 · 최대 200건"}</span><span aria-label="표시된 요청 건수" className="tabular-nums">{filtered.length} / {items.length}건 표시</span></div>}
    </Card>
}
