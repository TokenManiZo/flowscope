import { identityLabel } from "@/lib/display/identityLabel"
import { useEffect, useState } from "react"
import { Bot, ChevronDown, ChevronRight, CircleHelp, ScanLine, Send, UserRound } from "lucide-react"

import { Button } from "@/components/ui/button"
import { MethodBadge, StatusBadge } from "@/features/graph/httpBadges"
import { matrixVerdictTone } from "@/features/matrix/MatrixVerdictCell"
import type { EventRecord, Snapshot, Source, Verdict } from "@/lib/api/types"
import { evidenceOrdinalLabel, stripOrigin } from "@/lib/display/operationLabel"
import { RequestLabDialog } from "./RequestLabDialog"

/** 출처 아이콘. 색은 그래프 강조색과 같은 계열(HUMAN 파랑·SCANNER 빨강·LLM 노랑)이고, 이름은 툴팁과 접근 이름으로 준다. */
export const SOURCE_MARK: Record<Source, { Icon: typeof UserRound; label: string; className: string }> = {
  human: { Icon: UserRound, label: "HUMAN", className: "border-blue-500/50 bg-blue-500/10 text-blue-600 dark:text-blue-300" },
  scanner: { Icon: ScanLine, label: "SCANNER", className: "border-red-500/50 bg-red-500/10 text-red-600 dark:text-red-300" },
  llm: { Icon: Bot, label: "LLM", className: "border-yellow-500/50 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300" },
  unknown: { Icon: CircleHelp, label: "UNKNOWN", className: "border-border bg-muted text-muted-foreground" },
}
const SOURCE_ORDER: readonly Source[] = ["human", "scanner", "llm", "unknown"]

/** 신원마다 카드 하나, 카드 안은 출처마다 한 줄. 신원은 최근 요청 순, 출처는 H·S·L 순, 줄 안 요청은 최신순이다. */
function groupByIdentity(events: readonly EventRecord[], identities: Iterable<string>, identityOf: (event: EventRecord) => string) {
  const byIdentity = new Map<string, Map<Source, EventRecord[]>>()
  for (const event of [...events].sort((left, right) => right.timestamp - left.timestamp)) {
    const identity = identityOf(event)
    const sources = byIdentity.get(identity) ?? byIdentity.set(identity, new Map()).get(identity)!
    sources.set(event.source, [...(sources.get(event.source) ?? []), event])
  }
  // 판정은 있지만 요청 기록이 남지 않은 신원도 카드로 보여 준다.
  for (const idn of identities) if (!byIdentity.has(idn)) byIdentity.set(idn, new Map())
  return [...byIdentity].map(([idn, sources]) => ({
    idn,
    count: [...sources.values()].reduce((sum, items) => sum + items.length, 0),
    rows: SOURCE_ORDER.filter(source => sources.has(source)).map(source => ({ key: `${idn}|${source}`, source, events: sources.get(source)! })),
  }))
}

interface Props {
  events: readonly EventRecord[]
  snapshot: Snapshot
  disabled?: boolean
  onOpenRequestLab?(): void
  /** 신원별 서버 판정(선택한 API의 셀 중 가장 급한 판정). 있으면 카드 제목 옆에 보여 준다. */
  identityVerdicts?: ReadonlyMap<string, Verdict>
  identityOf?: (event: EventRecord) => string
  labelIdentity?: (identity: string) => string
}

/**
 * 선택 항목에 연결된 실제 관측 기록. 신원마다 카드 하나로 묶고 카드 안에 출처별 한 줄을 둔다. 줄의 보내기 버튼은 그 출처의 가장 최근
 * 요청을 Request Lab으로 열고, 요청이 여럿이면 펼쳐서 요청마다 열 수 있다. 재전송은 Request Lab에서만 한다(Burp Repeater로 보내지 않는다).
 */
export function EvidenceActionList({ events, snapshot, disabled = false, onOpenRequestLab, identityVerdicts, identityOf = event => event.idn, labelIdentity = identityLabel }: Props) {
  const [labContext, setLabContext] = useState<string | null>(null)
  const [openGroups, setOpenGroups] = useState<readonly string[]>([])
  const datasetRevision = snapshot.datasetRevision ?? snapshot.identityRevision ?? 0
  // 데이터셋 교체나 Evidence 좌표 변경은 열린 초안을 닫는다(D-140). 사라졌다 돌아온 Evidence도 다시 열리지 않는다.
  const contextOf = (event: EventRecord) => JSON.stringify([datasetRevision, event.eventId, event.op, event.resource, event.idn, event.source, event.fp])
  const labEvent = events.find(event => contextOf(event) === labContext) ?? null
  useEffect(() => { if (labContext && !labEvent) setLabContext(null) }, [labContext, labEvent])
  const sorted = [...events].sort((left, right) => right.timestamp - left.timestamp)
  const openLab = (event: EventRecord) => { onOpenRequestLab?.(); setLabContext(contextOf(event)) }

  if (!sorted.length && !identityVerdicts?.size) return <p className="text-sm text-muted-foreground">연결된 관측 기록이 없습니다.</p>
  const cards = groupByIdentity(sorted, identityVerdicts?.keys() ?? [], identityOf)
  const ordinal = (event: EventRecord) => evidenceOrdinalLabel(snapshot.evidenceOrdinals, event.eventId)
  const pathOf = (event: EventRecord) => stripOrigin(event.path) || event.path
  const toggle = (key: string) => setOpenGroups(current => current.includes(key) ? current.filter(item => item !== key) : [...current, key])
  return <section aria-label="관측 기록" className="grid gap-3">
    <h3 className="text-lg font-semibold">관측 기록</h3>
    <ul className="grid gap-4">{cards.map(card => {
      const verdict = identityVerdicts?.get(card.idn), tone = verdict ? matrixVerdictTone(verdict) : null
      return <li key={card.idn} aria-label={`${labelIdentity(card.idn)} 관측 기록 ${card.count}건`} className="overflow-hidden rounded-lg border border-border/70 bg-muted/20">
        <div className="flex min-w-0 items-center gap-2 px-4 py-3">
          <span className="truncate text-lg font-semibold">{labelIdentity(card.idn)}</span>
          {tone && <span className={`ms-auto shrink-0 rounded px-2 py-0.5 text-[13px] font-medium ${tone.className}`}>{tone.label}</span>}
        </div>
        {!card.rows.length && <p className="border-t border-border/70 px-4 py-2.5 text-[13px] text-muted-foreground">연결된 요청 기록이 없습니다.</p>}
        {card.rows.map(row => {
          const latest = row.events[0], mark = SOURCE_MARK[row.source] ?? SOURCE_MARK.unknown, open = openGroups.includes(row.key)
          const methods = [...new Set(row.events.map(event => event.method))], codes = [...new Set(row.events.map(event => event.status))].sort((left, right) => left - right)
          return <div key={row.key} role="group" aria-label={`${labelIdentity(card.idn)} · ${mark.label} ${row.events.length}건`} className="grid gap-2 border-t border-border/70 px-4 py-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <span role="img" aria-label={mark.label} title={mark.label} className={`inline-flex size-7 shrink-0 items-center justify-center rounded-full border ${mark.className}`}><mark.Icon className="size-4" aria-hidden="true" /></span>
              <span className="flex min-w-0 flex-wrap items-center gap-1.5">{methods.map(method => <MethodBadge key={method} method={method} />)}{codes.map(code => <StatusBadge key={code} code={code} />)}</span>
              {row.events.length > 1
                ? <button type="button" aria-expanded={open} aria-label={`요청 ${row.events.length}건 ${open ? "접기" : "펼치기"}`} onClick={() => toggle(row.key)} className="inline-flex shrink-0 items-center gap-0.5 rounded px-1 text-[13px] text-muted-foreground hover:bg-muted">{row.events.length}건{open ? <ChevronDown className="size-4" aria-hidden="true" /> : <ChevronRight className="size-4" aria-hidden="true" />}</button>
                : <span className="shrink-0 px-1 text-[13px] text-muted-foreground">1건</span>}
              <span className="ms-auto flex shrink-0 gap-1">
                <Button type="button" size="icon-sm" variant="outline" aria-label="Request Lab에서 보내기" title="Request Lab에서 보내기" disabled={disabled} onClick={() => openLab(latest)}><Send className="size-4" /></Button>
              </span>
            </div>
            {open && <ul aria-label={`${labelIdentity(card.idn)} · ${mark.label} 요청 목록`} className="grid">{row.events.map(event => <li key={event.eventId} aria-label={`관측 기록 ${ordinal(event)}`} className="grid grid-cols-[3rem_3.25rem_minmax(0,1fr)_auto] items-center gap-2 border-t border-border/50 py-2 text-[13px]">
              <span className="font-mono text-xs text-muted-foreground">{ordinal(event)}</span>
              <StatusBadge code={event.status} />
              <span className="truncate font-mono text-xs text-muted-foreground" title={`${event.method} ${pathOf(event)}`}>{pathOf(event)}</span>
              <span className="flex gap-0.5">
                <Button type="button" size="icon-sm" variant="ghost" aria-label={`${ordinal(event)} Request Lab에서 보내기`} title="Request Lab에서 보내기" disabled={disabled} onClick={() => openLab(event)}><Send className="size-4" /></Button>
              </span>
            </li>)}</ul>}
          </div>
        })}
      </li>
    })}</ul>
    {labEvent && <RequestLabDialog key={labContext} open onOpenChange={open => { if (!open) setLabContext(null) }} event={labEvent} accounts={snapshot.accounts} sessions={snapshot.managedSessions} verifications={snapshot.manualVerifications} datasetRevision={datasetRevision} snapshotRevision={snapshot.revision} suspended={disabled} />}
  </section>
}
