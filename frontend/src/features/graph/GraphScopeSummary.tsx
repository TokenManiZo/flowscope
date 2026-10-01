import { useState, type ReactNode } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"

import { Button } from "@/components/ui/button"
import { InfoHint } from "@/components/ui/info-hint"
import { SOURCE_MARK } from "@/features/evidence/EvidenceActionList"
import type { AuthorizationMatrix, Cell, Verdict } from "@/lib/api/types"
import { stripOrigin } from "@/lib/display/operationLabel"
import type { ApiGroup } from "./graphHierarchy"
import { MethodBadge } from "./httpBadges"
import { operationParts } from "./relationshipNodeCard"
import { scopeFindings, scopeRecommendations, UNDECIDED_REASON_LABEL, UNDECIDED_REASON_ORDER, type ScopeCandidate, type UndecidedReason } from "./graphScopeFindings"

const PREVIEW = 3
const GROUP_PREVIEW = 5
/** 신원 카드 문장·막대의 판정 순서와 색. 막대 색은 문장 옆 글자 색과 같다. */
const VERDICT_PARTS: ReadonlyArray<[Verdict, string, string]> = [
  ["suspicious", "후보", "#E24B4A"],
  ["allow", "허용", "#1D9E75"],
  ["deny", "거부", "#B4B2A9"],
  ["undecided", "확인 필요", "#EF9F27"],
  ["untested", "판정 보류", "#888780"],
]
const VERDICT_BADGE: Partial<Record<Verdict, [string, string]>> = {
  allow: ["ALLOW", "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"],
  deny: ["DENY", "border border-border text-muted-foreground"],
  untested: ["판정 보류", "border border-dashed border-border text-muted-foreground"],
}
const severity: readonly Verdict[] = ["suspicious", "undecided", "untested", "deny", "allow"]
const label = (resource: string) => stripOrigin(resource) || resource
const RED = "bg-red-500/15 text-red-700 dark:text-red-300"
const BLUE = "bg-sky-500/15 text-sky-700 dark:text-sky-300"
const AMBER = "bg-amber-500/15 text-amber-700 dark:text-amber-300"

interface Props {
  scope: "site" | "group"
  groups: readonly ApiGroup[]
  owners?: Readonly<Record<string, string>>
  /** 판정 매트릭스. 테스트 추천을 매트릭스와 같은 값으로 보여 준다. */
  matrix?: AuthorizationMatrix | null
  /** 후보·추천·확인 필요 줄: 그 API가 있는 그룹을 열고 API 카드를 고른다. */
  onRevealOperation?(groupId: string, operation: string): void
  /** 사이트 요약의 그룹 줄: 그 그룹 카드를 고른다. */
  onSelectGroup?(groupId: string): void
  /** 그룹 요약의 [이 그룹 열기]. */
  onOpenGroup?(groupId: string): void
}

function Row({ method, path, sub, badge, badgeClass, onClick }: { method: string; path: string; sub: string; badge: string; badgeClass: string; onClick?(): void }) {
  return <li><button type="button" onClick={onClick} className="grid w-full grid-cols-[4.25rem_minmax(0,1fr)_auto] items-center gap-2 border-t border-border/70 py-2 text-left hover:bg-muted/40">
    <span><MethodBadge method={method} /></span>
    <span className="min-w-0"><span className="block truncate font-mono text-[13px]" title={path}>{path}</span>{sub && <span className="block truncate text-xs text-muted-foreground">{sub}</span>}</span>
    {badge ? <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-medium ${badgeClass}`}>{badge}</span> : <span />}
  </button></li>
}

function More({ hidden, open, onToggle, noun }: { hidden: number; open: boolean; onToggle(): void; noun: string }) {
  if (hidden <= 0) return null
  return <button type="button" onClick={onToggle} className="w-full border-t border-border/70 py-2 text-left text-[13px] text-sky-600 hover:underline dark:text-sky-300">{open ? "접기" : `${noun} ${hidden}개 더 보기`}</button>
}

function Heading({ className, children, hint, hintLabel, note }: { className: string; children: ReactNode; hint?: ReactNode; hintLabel?: string; note?: string }) {
  return <h3 className={`mb-1 flex items-center gap-1 text-sm font-semibold ${className}`}>{children}{hint && hintLabel && <InfoHint label={hintLabel}>{hint}</InfoHint>}{note && <span className="text-xs font-normal text-muted-foreground">{note}</span>}</h3>
}

/**
 * 사이트·API 그룹을 골랐을 때(또는 그 화면에서 아무것도 고르지 않았을 때)의 요약.
 * 순서: 숫자 → (있을 때만) IDOR·BFLA 후보 경고 → 테스트 추천(판정 매트릭스와 같은 값) → 확인 필요(이유별)
 * → (사이트) API 그룹 → 신원별 접근 → (그룹) 나머지 API·그룹 열기. 항목이 많아도 기본 화면은 짧게 유지한다.
 */
export function GraphScopeSummary({ scope, groups, owners = {}, matrix, onRevealOperation, onSelectGroup, onOpenGroup }: Props) {
  const [typeFilter, setTypeFilter] = useState<"all" | "IDOR" | "BFLA">("all")
  const [allCandidates, setAllCandidates] = useState(false)
  const [allRecommendations, setAllRecommendations] = useState(false)
  const [openReasons, setOpenReasons] = useState<readonly UndecidedReason[]>([])
  const [allReasons, setAllReasons] = useState<readonly UndecidedReason[]>([])
  const [allGroups, setAllGroups] = useState(false)
  const [restOpen, setRestOpen] = useState(false)
  const cells: readonly Cell[] = groups.flatMap(group => group.cells)
  const { candidates, undecided, identities } = scopeFindings(cells)
  const recommendations = scopeRecommendations(matrix, new Set(groups.flatMap(group => group.operations)))
  const bflaRecommendations = recommendations.filter(item => item.type === "BFLA").length
  const groupOf = (operation: string) => groups.find(group => group.operations.includes(operation))?.id ?? groups[0]?.id ?? ""
  const reveal = (operation: string) => onRevealOperation?.(groupOf(operation), operation)
  const idor = candidates.filter(item => item.type === "IDOR").length, bfla = candidates.length - idor
  const filtered = typeFilter === "all" ? candidates : candidates.filter(item => item.type === typeFilter)
  const candidateSub = (item: ScopeCandidate) => {
    if (!item.resource) return item.idn
    const owner = owners[item.resource]
    return `${item.idn} → ${label(item.resource)}${owner && owner !== item.idn ? ` (소유자 ${owner})` : ""}`
  }
  const toggle = <T,>(list: readonly T[], value: T) => list.includes(value) ? list.filter(item => item !== value) : [...list, value]
  const endpointCount = groups.reduce((sum, group) => sum + group.endpointCount, 0)
  const flagged = new Set([...candidates, ...undecided].map(item => item.op))
  const rest = [...new Set(cells.map(cell => cell.op))].filter(op => !flagged.has(op)).map(op => {
    const verdicts = cells.filter(cell => cell.op === op).map(cell => cell.overall)
    return { op, verdict: severity.find(value => verdicts.includes(value)) ?? "untested" }
  })
  const groupRows = [...groups].map(group => {
    const found = scopeFindings(group.cells)
    return { group, candidates: found.candidates.length, recommended: scopeRecommendations(matrix, new Set(group.operations)).length, undecided: found.undecided.length }
  }).sort((left, right) => right.candidates - left.candidates || right.recommended - left.recommended || right.undecided - left.undecided || left.group.label.localeCompare(right.group.label))

  return <section aria-label={scope === "site" ? "사이트 요약" : "API 그룹 요약"} className="mb-4 grid gap-4 border-b pb-4 text-sm">
    <dl className="grid grid-cols-3 gap-2">
      <div className="rounded-md border border-border/70 px-2 py-1.5"><dt className="text-xs text-muted-foreground">API</dt><dd className="text-base font-semibold tabular-nums">{endpointCount}</dd></div>
      <div className={`rounded-md border px-2 py-1.5 ${recommendations.length ? "border-sky-500/50 bg-sky-500/10" : "border-border/70"}`}><dt className="text-xs text-muted-foreground">테스트 추천</dt><dd className={`text-base font-semibold tabular-nums ${recommendations.length ? "text-sky-700 dark:text-sky-300" : ""}`}>{recommendations.length}</dd>{recommendations.length > 0 && <dd className="text-[11px] text-muted-foreground">BFLA {bflaRecommendations} · BOLA/IDOR {recommendations.length - bflaRecommendations}</dd>}</div>
      <div className={`rounded-md border px-2 py-1.5 ${undecided.length ? "border-amber-500/50 bg-amber-500/10" : "border-border/70"}`}><dt className="text-xs text-muted-foreground">확인 필요</dt><dd className={`text-base font-semibold tabular-nums ${undecided.length ? "text-amber-700 dark:text-amber-300" : ""}`}>{undecided.length}</dd></div>
    </dl>

    {candidates.length > 0 && <div role="alert" aria-label="IDOR·BFLA 후보" className="rounded-lg border border-red-500/50 bg-red-500/10 p-3">
      <Heading className="text-red-700 dark:text-red-300" hintLabel="IDOR·BFLA 후보" hint={<><p className="font-medium">IDOR·BFLA 후보란?</p><p className="text-muted-foreground">막혀야 할 요청이 실제로 성공한 기록이 있는 조합이에요. 취약점일 가능성이 높으니 먼저 확인하세요. 판정 매트릭스의 "후보"와 같은 값이에요.</p></>}>● IDOR·BFLA 후보 {candidates.length}</Heading>
      {idor > 0 && bfla > 0 && <div role="group" aria-label="후보 종류" className="mb-1 flex gap-1">{([["all", `전체 ${candidates.length}`], ["IDOR", `IDOR ${idor}`], ["BFLA", `BFLA ${bfla}`]] as const).map(([value, text]) => <button key={value} type="button" aria-pressed={typeFilter === value} onClick={() => { setTypeFilter(value); setAllCandidates(false) }} className={`rounded-full border px-2 py-0.5 text-xs ${typeFilter === value ? "border-red-500/60 bg-red-500/10 text-red-600 dark:text-red-300" : "border-border text-muted-foreground"}`}>{text}</button>)}</div>}
      <ul aria-label="IDOR·BFLA 후보 목록">{(allCandidates ? filtered : filtered.slice(0, PREVIEW)).map(item => <Row key={item.key} method={item.method} path={item.path} sub={candidateSub(item)} badge={`${item.type} 후보`} badgeClass={RED} onClick={() => reveal(item.op)} />)}</ul>
      <More hidden={filtered.length - PREVIEW} open={allCandidates} onToggle={() => setAllCandidates(value => !value)} noun="후보" />
    </div>}

    {recommendations.length > 0 && <div>
      <Heading className="text-sky-700 dark:text-sky-300" hintLabel="테스트 추천" note="판정 매트릭스와 같은 값" hint={<><p className="font-medium">테스트 추천이란?</p><p className="text-muted-foreground">아직 해 보지 않은 교차 조합이에요. 예를 들어 한 신원의 요청을 다른 신원의 세션으로 보내 보라는 뜻이에요. 취약점이 아니라 해 볼 테스트예요.</p></>}>테스트 추천</Heading>
      <ul aria-label="테스트 추천 목록">{(allRecommendations ? recommendations : recommendations.slice(0, PREVIEW)).map(item => <Row key={item.id} method={item.method} path={item.path} sub={`${item.basis} 요청 → ${item.test} 세션으로${item.resource ? ` · ${label(item.resource)}` : ""}`} badge={item.type} badgeClass={BLUE} onClick={() => reveal(item.op)} />)}</ul>
      <More hidden={recommendations.length - PREVIEW} open={allRecommendations} onToggle={() => setAllRecommendations(value => !value)} noun="추천" />
      <a href="#matrix" className="block border-t border-border/70 py-2 text-[13px] text-sky-600 hover:underline dark:text-sky-300">판정 매트릭스에서 {recommendations.length}개 모두 보기 →</a>
    </div>}

    {undecided.length > 0 && <div>
      <Heading className="text-amber-700 dark:text-amber-300" hintLabel="확인 필요" note="이유별" hint={<><p className="font-medium">확인 필요란?</p><p className="text-muted-foreground">FlowScope가 허용·차단을 정할 근거가 부족한 요청이에요. 원문을 한 번 봐 주세요.</p><ul className="mt-2 grid gap-1.5 text-xs text-muted-foreground"><li><b className="font-medium text-foreground">서버 오류·없는 경로</b> (404·429·5xx): 권한 때문에 막힌 건지 알 수 없어요. 대개 문제가 아니에요.</li><li><b className="font-medium text-foreground">객체 포함 여부 미확인</b>: 막혀야 할 요청이 200인데 응답에서 그 객체를 못 찾았어요. IDOR일 수 있어요.</li><li><b className="font-medium text-foreground">OPTIONS·HEAD 요청</b>: 실제 데이터 없이 사전 확인이나 헤더만 주고받는 요청이에요. 200이 와도 접근 성공의 증거로 보지 않아요.</li></ul></>}>확인 필요</Heading>
      <ul className="grid gap-1.5" aria-label="확인 필요 이유">{UNDECIDED_REASON_ORDER.map(reason => {
        const items = undecided.filter(item => item.reason === reason)
        if (!items.length) return null
        const open = openReasons.includes(reason), all = allReasons.includes(reason)
        return <li key={reason} className={`rounded-md border ${reason === "object" ? "border-amber-500/50" : "border-border/70"} bg-muted/20`}>
          <button type="button" aria-expanded={open} onClick={() => setOpenReasons(current => toggle(current, reason))} className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-[13px]">
            {open ? <ChevronDown className="size-4 shrink-0" aria-hidden="true" /> : <ChevronRight className="size-4 shrink-0" aria-hidden="true" />}
            <span className={reason === "object" ? "font-medium" : ""}>{UNDECIDED_REASON_LABEL[reason]}</span>
            {reason === "object" && <span className={`rounded px-1 text-[11px] ${AMBER}`}>IDOR 가능</span>}
            <span className="ms-auto font-mono text-xs text-muted-foreground">{items.length}</span>
          </button>
          {open && <div className="px-2 pb-1">
            <ul aria-label={`${UNDECIDED_REASON_LABEL[reason]} 목록`}>{(all ? items : items.slice(0, PREVIEW)).map(item => <Row key={item.key} method={item.method} path={item.path} sub={item.resource ? `${item.idn} → ${label(item.resource)}` : item.idn} badge="확인 필요" badgeClass={AMBER} onClick={() => reveal(item.op)} />)}</ul>
            <More hidden={items.length - PREVIEW} open={all} onToggle={() => setAllReasons(current => toggle(current, reason))} noun="요청" />
          </div>}
        </li>
      })}</ul>
    </div>}

    {scope === "site" && groupRows.length > 0 && <div>
      <Heading className="text-muted-foreground" note="할 일이 많은 순" hintLabel="API 그룹 상태" hint={<p className="text-muted-foreground">후보·테스트 추천·확인 필요가 모두 0이면 "관측된 의심 없음"으로 적어요. 지금까지 관측한 요청에서 의심이 없다는 뜻이고, 아직 해 보지 않은 조합까지 안전하다는 뜻은 아니에요.</p>}>API 그룹</Heading>
      <ul aria-label="API 그룹 목록">{(allGroups ? groupRows : groupRows.slice(0, GROUP_PREVIEW)).map(({ group, candidates: hot, recommended, undecided: warn }) => <li key={group.id}><button type="button" onClick={() => onSelectGroup?.(group.id)} className="flex w-full items-center gap-2 border-t border-border/70 py-2 text-left text-[13px] hover:bg-muted/40">
        <span className="min-w-0 truncate">{group.label}</span><span className="text-xs text-muted-foreground">· {group.endpointCount}</span>
        <span className="ms-auto flex shrink-0 gap-1">
          {hot > 0 && <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${RED}`}>후보 {hot}</span>}
          {recommended > 0 && <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${BLUE}`}>추천 {recommended}</span>}
          {warn > 0 && <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${AMBER}`}>확인 {warn}</span>}
          {!hot && !recommended && !warn && <span className="rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground">관측된 의심 없음</span>}
        </span>
      </button></li>)}</ul>
      <More hidden={groupRows.length - GROUP_PREVIEW} open={allGroups} onToggle={() => setAllGroups(value => !value)} noun="그룹" />
    </div>}

    {identities.length > 0 && <div>
      <Heading className="text-muted-foreground" hintLabel="신원별 접근" hint={<p className="text-muted-foreground">API마다 그 신원의 가장 급한 판정 하나로 세서, 숫자를 더하면 접근한 API 수와 같아요. 판정 보류는 소유자·권한 정책을 몰라 판단을 미룬 거예요.</p>}>신원별 접근</Heading>
      <ul className="grid gap-2" aria-label="신원별 접근">{identities.map(identity => {
        const parts = VERDICT_PARTS.filter(([verdict]) => identity.counts[verdict])
        return <li key={identity.idn} aria-label={`${identity.idn} 접근 요약`} className="rounded-lg border border-border/70 bg-muted/20 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-[15px] font-semibold">{identity.idn}</span>
            <span className="ms-auto flex shrink-0 gap-1">{identity.sources.map(source => { const mark = SOURCE_MARK[source]; return <span key={source} role="img" aria-label={mark.label} title={mark.label} className={`inline-flex size-6 items-center justify-center rounded-full border ${mark.className}`}><mark.Icon className="size-3.5" aria-hidden="true" /></span> })}</span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">API <b className="font-semibold text-foreground">{identity.apis}개</b>에 접근 — {parts.map(([verdict, text], index) => <span key={verdict}>{index > 0 && " · "}{text} <b className="font-semibold text-foreground">{identity.counts[verdict]}</b></span>)}</p>
          <div aria-hidden="true" className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-muted">{parts.map(([verdict, , color]) => <i key={verdict} className="block h-full" style={{ width: `${(identity.counts[verdict]! / identity.apis) * 100}%`, background: color }} />)}</div>
        </li>
      })}</ul>
    </div>}

    {scope === "group" && rest.length > 0 && <div>
      <button type="button" aria-expanded={restOpen} onClick={() => setRestOpen(value => !value)} className="flex items-center gap-1 text-[13px] text-sky-600 hover:underline dark:text-sky-300">{restOpen ? <ChevronDown className="size-4" aria-hidden="true" /> : <ChevronRight className="size-4" aria-hidden="true" />}허용·거부·판정 보류 API {rest.length}개 보기</button>
      {restOpen && <ul aria-label="허용·거부 API" className="mt-1">{rest.map(({ op, verdict }) => { const { method, path } = operationParts(op); const [text, className] = VERDICT_BADGE[verdict] ?? ["", ""]; return <Row key={op} method={method} path={path} sub="" badge={text} badgeClass={className} onClick={() => reveal(op)} /> })}</ul>}
    </div>}

    {scope === "group" && groups[0] && onOpenGroup && <Button type="button" variant="outline" className="w-full" onClick={() => onOpenGroup(groups[0].id)}>이 그룹 열기 →</Button>}
  </section>
}
