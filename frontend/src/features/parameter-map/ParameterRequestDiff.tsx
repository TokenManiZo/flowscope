import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { SurfaceEndpoint, SurfaceParameter } from "@/lib/api/types"
import { locationLabel } from "./parameterNodeCard"
import { parameterMapKey } from "./parameterProjection"
import type { ParameterContext, StructuredParameterMetadata } from "./requestDiff"
import { diffParameterContexts, structuralShape } from "./requestDiff"

export interface EvidenceParameterContext extends ParameterContext {
  parameters: readonly (StructuredParameterMetadata & { byteLength?: number | null; confidence?: string; contextSignature?: string | null; displayShape?: string })[]
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

/**
 * Surface 사실에서 한 Evidence의 요청 문맥을 만든다: 그 Evidence를 관측한 파라미터 metadata(값 없음)와
 * endpoint requestContexts의 완전성·보존 여부. 문맥이 없으면 completeness는 기록되지 않은 것으로 둔다.
 */
export function evidenceParameterContext(endpoint: SurfaceEndpoint, eventId: string, header: Pick<EvidenceParameterContext, "identity" | "role" | "source" | "status" | "verdict">): EvidenceParameterContext {
  const context = (endpoint.requestContexts ?? []).find(item => item.evidenceId === eventId)
  const parameters = endpoint.parameters.flatMap((parameter: SurfaceParameter) => parameter.observations
    .filter(observation => observation.evidenceId === eventId && parameter.coordinateResolved !== false)
    .map(observation => ({
      key: parameterMapKey(endpoint.key, parameter.location, parameter.canonicalPath),
      presence: observation.presence === "EXPLICIT_NULL" ? "EXPLICIT_NULL" as const : "PRESENT" as const,
      shape: structuralShape(observation.shape), displayShape: observation.shape,
      valueType: (observation.valueType ?? "UNKNOWN") as StructuredParameterMetadata["valueType"],
      occurrenceCount: null, digest: null, byteLength: observation.byteLength ?? null, confidence: observation.confidence, contextSignature: observation.contextSignature ?? null,
    })))
  return {
    eventId, service: endpoint.key.service, method: endpoint.key.method, operation: `${endpoint.key.service} ${endpoint.key.method} ${endpoint.key.pathTemplate}`,
    ...header,
    complete: context?.complete === true, retention: context ? context.retained ? "RETAINED" : "METADATA_ONLY" : "UNKNOWN",
    completenessReason: context ? undefined : "COMPLETENESS_NOT_RECORDED", parameters,
  }
}

export function ParameterRequestDiff({ left, right }: { left: EvidenceParameterContext; right: EvidenceParameterContext }) {
  const rows = diffParameterContexts(left, right)
  const metadata = [left, right].map(context => {
    const index = new Map<string, (typeof context.parameters)[number] | null>()
    for (const item of context.parameters) if (item.key) index.set(item.key.stableKey, index.has(item.key.stableKey) ? null : item)
    return index
  })
  return <section aria-label="구조화 요청 비교" className="min-w-0 space-y-3">
    <p className="text-xs text-muted-foreground">{!left.complete || !right.complete ? "불완전하거나 완전성이 확인되지 않은 문맥 · 누락은 UNKNOWN입니다. " : "구조화된 관측 문맥입니다. "}미관측 ≠ 미존재. 값 원문은 읽지 않으며 값 digest는 노출하지 않아 값 변경 여부는 UNKNOWN으로 남습니다. HTTP 상태와 서버 표시 판정만으로 취약점을 확정하지 않습니다.</p>
    {(left.completenessReason || right.completenessReason) && <p className="text-xs text-muted-foreground">COMPLETENESS_NOT_RECORDED · 전체 추출 완전성은 기록되지 않았습니다.</p>}
    <div role="region" aria-label="요청 비교 표" tabIndex={0} className="max-w-full overflow-auto rounded-md border">
      <Table className="min-w-[36rem]"><TableHeader><TableRow><TableHead>입력 / 차이</TableHead><TableHead>기준 요청 {left.eventId}</TableHead><TableHead>비교 요청 {right.eventId}</TableHead></TableRow></TableHeader>
        <TableBody><TableRow><TableHead scope="row" className="whitespace-normal">응답 / 서버 표시 판정<p className="text-xs text-amber-300">{left.status !== right.status && "STATUS_CHANGED "}{left.verdict !== right.verdict && "VERDICT_CHANGED"}</p></TableHead>{[left, right].map((context, i) => <TableCell key={i}>{context.status ?? "UNKNOWN"} · {context.verdict}<br />{context.identity} / {context.role} / {context.source}</TableCell>)}</TableRow>
          {rows.map(row => <TableRow key={row.id}><TableHead scope="row" className="max-w-48 whitespace-normal [overflow-wrap:anywhere]">{row.parameterKey ? locationLabel(row.parameterKey.location) : ""} {row.path}<p className="mt-1 text-xs text-amber-300">{row.changes.join(" · ")}</p></TableHead>{[row.left, row.right].map((side, i) => {
            const detail = metadata[i].get(row.parameterKey?.stableKey ?? "")
            return <TableCell key={i} className="max-w-64 whitespace-normal align-top text-xs [overflow-wrap:anywhere]">
              <p>{side.presence}</p><p>{side.shape}{detail?.displayShape && detail.displayShape !== side.shape ? ` (${detail.displayShape})` : ""} / {side.valueType}</p><p>{side.retention}</p>{side.unknownReason && <p>{side.unknownReason}</p>}
              <p>길이: {detail?.byteLength ?? "UNKNOWN"} bytes</p><p>관측 신뢰: {detail?.confidence ?? "UNKNOWN"}</p><p>문맥: {detail?.contextSignature ?? "UNKNOWN"}</p>
            </TableCell>
          })}</TableRow>)}
        </TableBody>
      </Table>
    </div>
    {!rows.length && <p>구조화 파라미터 정보 없음 · UNKNOWN</p>}
  </section>
}
