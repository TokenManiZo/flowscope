import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { locationLabel } from "./parameterNodeCard"
import type { ParameterContext, StructuredParameterMetadata } from "./requestDiff"
import { diffParameterContexts } from "./requestDiff"

/** Evidence API의 안전 metadata로 만든 한 요청의 문맥(PR#11). 값 원문·preview는 없고 digest·길이·형태·완전성만 있다. */
export interface EvidenceParameterContext extends ParameterContext {
  parameters: readonly (StructuredParameterMetadata & { byteLength?: number | null; confidence?: string; contextSignature?: string | null })[]
  eventId: string
  service: string
  method: string
  operation: string
  identity: string
  role: string
  source: string
  status: number | null
  verdict: string
  completenessReason?: string
}

export function ParameterRequestDiff({ left, right }: { left: EvidenceParameterContext; right: EvidenceParameterContext }) {
  const rows = diffParameterContexts(left, right)
  const metadata = [left, right].map(context => {
    const index = new Map<string, EvidenceParameterContext["parameters"][number]>()
    for (const parameter of context.parameters) if (parameter.key) index.set(parameter.key.stableKey, parameter)
    return index
  })
  const reasons = [...new Set([left.completenessReason, right.completenessReason].filter((reason): reason is string => !!reason))]
  return <section aria-label="구조화 요청 비교" className="min-w-0 space-y-3">
    <p className="text-xs text-muted-foreground">{!left.complete || !right.complete ? "불완전하거나 완전성이 확인되지 않은 문맥 · 누락은 UNKNOWN입니다. " : "구조화된 관측 문맥입니다. "}미관측 ≠ 미존재. 값 원문은 읽지 않으며 값 변경은 SHA-256 digest 비교로만 판단합니다. HTTP 상태와 서버 표시 판정만으로 취약점을 확정하지 않습니다.</p>
    {reasons.length > 0 && <p className="text-xs text-muted-foreground">{reasons.join(" / ")} · 전체 추출 완전성이 기록되지 않았거나 불완전합니다.</p>}
    <div role="region" aria-label="요청 비교 표" tabIndex={0} className="max-w-full overflow-auto rounded-md border">
      <Table className="min-w-[36rem]"><TableHeader><TableRow><TableHead>입력 / 차이</TableHead><TableHead>기준 요청 {left.eventId}</TableHead><TableHead>비교 요청 {right.eventId}</TableHead></TableRow></TableHeader>
        <TableBody><TableRow><TableHead scope="row" className="whitespace-normal">응답 / 서버 표시 판정<p className="text-xs text-amber-300">{left.status !== right.status && "STATUS_CHANGED "}{left.verdict !== right.verdict && "VERDICT_CHANGED"}</p></TableHead>{[left, right].map((context, i) => <TableCell key={i}>{context.status ?? "UNKNOWN"} · {context.verdict}<br />{context.identity} / {context.role} / {context.source}</TableCell>)}</TableRow>
          {rows.map(row => <TableRow key={row.id}><TableHead scope="row" className="max-w-48 whitespace-normal [overflow-wrap:anywhere]">{row.parameterKey ? locationLabel(row.parameterKey.location) : ""} {row.path}<p className="mt-1 text-xs text-amber-300">{row.changes.join(" · ")}</p></TableHead>{[row.left, row.right].map((side, i) => {
            const detail = side.unknownReason ? undefined : metadata[i].get(row.parameterKey?.stableKey ?? "")
            return <TableCell key={i} className="max-w-64 whitespace-normal align-top text-xs [overflow-wrap:anywhere]">
              <p>{side.presence}</p><p>{side.shape} / {side.valueType}</p><p>발생 수: {side.occurrenceCount ?? "UNKNOWN"}</p><p>SHA-256: {side.digest ?? "UNKNOWN · digest 사용 불가"}</p><p>{side.retention}</p>{side.unknownReason && <p>{side.unknownReason}</p>}
              <p>길이: {detail?.byteLength ?? "UNKNOWN"} bytes</p><p>관측 신뢰: {detail?.confidence ?? "UNKNOWN"}</p><p>문맥: {detail?.contextSignature ?? "UNKNOWN"}</p>
            </TableCell>
          })}</TableRow>)}
        </TableBody>
      </Table>
    </div>
  </section>
}
