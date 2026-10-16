import { FileText } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { LlmFinding } from "@/lib/api/types"
import { findingStatus, findingStatusLabel } from "./findingResults"

export function McpFindingRow({ finding, ordinals, onOpenEvidence }: {
  finding: LlmFinding
  ordinals?: Readonly<Record<string, number>>
  onOpenEvidence(id: string): void
}) {
  const evidence = [...new Set([...finding.evidenceIds, ...finding.judgmentEvidenceIds])]
  return <details className="py-3">
    <summary className="cursor-pointer break-words text-sm font-medium">
      <Badge variant="outline" className="mr-2">{findingStatusLabel[findingStatus(finding)]}</Badge>
      {finding.issueTitle || finding.verdict || finding.note || "LLM 소견"}
      <span className="ml-3 font-normal text-muted-foreground">{finding.identity}</span>
    </summary>
    <div className="space-y-3 pt-3">
      <p className="break-all font-mono text-xs text-muted-foreground">{finding.operation}</p>
      {finding.verificationResult && <section><h3 className="mb-1 text-sm font-medium">검증 결과</h3><p className="whitespace-pre-wrap break-words text-sm">{finding.verificationResult}</p></section>}
      {finding.judgmentBasis && <section><h3 className="mb-1 text-sm font-medium">판단 근거</h3><p className="whitespace-pre-wrap break-words text-sm">{finding.judgmentBasis}</p></section>}
      {(finding.judgmentReason || finding.note) && <p className="whitespace-pre-wrap break-words text-sm">{finding.judgmentReason || finding.note}</p>}
      {finding.confidence && <p className="text-xs text-muted-foreground">신뢰도 {finding.confidence}</p>}
      <div className="flex flex-wrap gap-2">{evidence.map(id => <Button key={id} size="sm" variant="outline" onClick={() => onOpenEvidence(id)}><FileText />원문 #{ordinals?.[id] ?? id}</Button>)}</div>
    </div>
  </details>
}
