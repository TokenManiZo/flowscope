import { useEffect, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { Scenario } from "@/lib/api/types"
import { ScenarioCard, scenarioRiskTone, scenarioTitleParts, type ScenarioEvidenceAction } from "./ScenarioCard"

const SCENARIO_LIST_LIMIT = 6
const CANDIDATE_TEXT_LIMIT = 100

function bounded(value: string) { return value.length > CANDIDATE_TEXT_LIMIT ? `${value.slice(0, CANDIDATE_TEXT_LIMIT)}…` : value }

interface Props {
  scenarios: readonly Scenario[]
  selectedId: string | null
  onSelect(id: string): void
  ordinals?: Readonly<Record<string, number>>
  onOpenEvidence: ScenarioEvidenceAction
}

export function ScenarioWorkspace({ scenarios, selectedId, onSelect, ordinals, onOpenEvidence }: Props) {
  const [expanded, setExpanded] = useState(false)
  useEffect(() => setExpanded(false), [scenarios])
  const visible = expanded ? scenarios : scenarios.slice(0, SCENARIO_LIST_LIMIT)
  const selected = scenarios.find((scenario) => scenario.id === selectedId) ?? null

  return <div className="grid gap-4 lg:grid-cols-[minmax(20rem,1fr)_minmax(0,1.6fr)]">
    <section aria-label="시나리오 후보 목록"><Card><CardHeader><CardTitle>시나리오 후보</CardTitle><CardDescription>규칙이 찾은 후보입니다. 사람이 검토해 확정합니다.</CardDescription></CardHeader><CardContent className="grid gap-3"><ul className="grid gap-2">{visible.map((scenario) => {
      const risk = scenarioRiskTone(scenario.risk)
      const { name, target } = scenarioTitleParts(bounded(scenario.title))
      return <li key={scenario.id}><Button type="button" variant={scenario.id === selectedId ? "secondary" : "outline"} aria-pressed={scenario.id === selectedId} className="h-auto w-full justify-start whitespace-normal p-3 text-left" onClick={() => onSelect(scenario.id)}><span className="grid min-w-0 gap-2"><span className="grid gap-0.5"><span className="font-medium">{name}</span>{target && <span className="break-all font-mono text-xs text-muted-foreground">{target}</span>}</span><span className="flex flex-wrap gap-2"><Badge variant={risk.variant} className={risk.className}>{bounded(scenario.risk)}</Badge><Badge variant="outline">규칙 후보</Badge></span></span></Button></li>
    })}</ul>{scenarios.length > SCENARIO_LIST_LIMIT && <Button type="button" variant="link" size="sm" className="h-auto w-fit p-0" onClick={() => setExpanded((current) => !current)}>{expanded ? "시나리오 목록 접기" : "시나리오 목록 더 보기"}</Button>}</CardContent></Card></section>
    <section aria-label="선택한 시나리오 상세">{selected ? <ScenarioCard key={selected.id} scenario={selected} ordinals={ordinals} onOpenEvidence={onOpenEvidence} /> : <p className="rounded-md border p-6 text-sm text-muted-foreground">상세에서 확인할 후보를 선택하세요.</p>}</section>
  </div>
}
