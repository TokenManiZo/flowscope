import { describe, expect, it } from "vitest"

import type { Snapshot } from "@/lib/api/types"
import sampleJson from "@/test/sample/sample-snapshot.json"
import { graphCellKey, projectRouteCandidates } from "./graph/graphProjection"
import { navigateHierarchy, projectHierarchy, type GraphNavigation } from "./graph/graphHierarchy"
import { findJudgmentItem } from "./matrix/judgmentProjection"
import { projectMatrix } from "./matrix/matrixProjection"
import { defaultParameterFilters, projectParameterMap, validationCellId } from "./parameter-map/parameterProjection"

/**
 * 화면 간 선택·Evidence 일관성(7단계): 패키지 Standalone 샘플의 실제 `/api/snapshot`(값·원문·digest 없음)을 한 번 캡처해
 * 우선순위 Gap 그래프·계층 관계 그래프·판정 매트릭스·기존 권한 매트릭스가 같은 좌표에서 같은 서버 Evidence를 열게 되는지 고정한다.
 * 어떤 projection도 판정·Evidence를 새로 만들지 않는다.
 */
// bundler 해석은 JSON 리터럴 타입을 추론하므로 서버 계약 타입으로만 다시 좁힌다.
const sample = sampleJson as unknown as Snapshot
const eventIds = new Set(sample.events.flatMap((event) => [event.eventId, ...(event.clusterEvidenceIds ?? [])]))
const authorityCell = (idn: string, op: string, resource: string | null) => sample.cells.find((cell) => cell.idn === idn && cell.op === op && cell.resource === resource)
const filters = { source: ["human", "scanner", "llm"] as const, identity: [], view: "source" as const, includeRouteCandidates: false, includeSupportTraffic: false, expanded: false }

describe("cross-screen selection on the packaged sample snapshot", () => {
  it("captured a value-free sample snapshot with every ported section present", () => {
    expect(sample.sampleMode).toBe(true)
    expect(sample.surface?.parameterGaps?.length).toBeGreaterThan(0)
    expect(sample.surface?.validationCells?.length).toBeGreaterThan(0)
    expect(sample.authorizationMatrix?.objects.length).toBeGreaterThan(0)
    const serialized = JSON.stringify(sample)
    for (const forbidden of ["maskedPreview", "\"digest\"", "reqText", "respText", "***MASKED***", "Bearer "]) expect(serialized).not.toContain(forbidden)
  })

  it("resolves priority-queue gaps and their validation cells to server 요청 기록 that the graph and matrix also expose", () => {
    const map = projectParameterMap(sample, { ...defaultParameterFilters, riskOnly: false, statuses: ["OPEN", "VERIFIED", "DISMISSED"] }, null)
    expect(map.queue.length).toBe(sample.surface!.parameterGaps!.length)
    const serverCellIds = new Set(sample.surface!.validationCells!.map((cell) => validationCellId(cell)))
    let matchedAuthority = 0
    for (const gap of map.queue) {
      const declared = new Set(sample.surface!.endpoints.flatMap((endpoint) => endpoint.parameters.flatMap((parameter) => parameter.declarations.map((declaration) => declaration.evidenceId))))
      for (const id of gap.evidenceIds) expect(eventIds.has(id) || declared.has(id), `gap ${gap.id} witness ${id}`).toBe(true)
      const selection = projectParameterMap(sample, { ...defaultParameterFilters, riskOnly: false, statuses: ["OPEN", "VERIFIED", "DISMISSED"] }, gap.id)
      for (const cell of selection.validationCells) {
        expect(serverCellIds.has(cell.id), `cell ${cell.id} must come from the server list`).toBe(true)
        if (cell.verdict === "UNTESTED" || !cell.identity) continue
        const authority = authorityCell(cell.identity, `${cell.endpoint.service} ${cell.endpoint.method} ${cell.endpoint.pathTemplate}`, cell.targetResource)
        if (!authority) continue
        matchedAuthority += 1
        for (const id of cell.evidenceIds) expect(authority.evidenceIds, `validation cell 요청 기록 ${cell.id}건 ${id} belongs to its authority cell`).toContain(id)
      }
    }
    expect(matchedAuthority).toBeGreaterThan(0)
  })

  it("opens the same authority cell 요청 기록 from the graph Object View, the judgment matrix, and the legacy matrix", () => {
    const operation = sample.cells.find((cell) => cell.resource !== null)!.op
    const site = projectHierarchy(sample, filters, { level: "site", groupId: "", operation: "", operationLimit: 18, objectLimit: 18, focusCandidateKey: "" })
    const group = site.groups.find((item) => item.operations.includes(operation))!
    const navigation: GraphNavigation = navigateHierarchy(navigateHierarchy(site.navigation, "group", group.id), "operation", group.id, operation)
    const objectView = projectHierarchy(sample, { ...filters, expandedObjectGroups: sample.displayObjects?.map(object => `object-group:${object.groupKey}`) }, navigation)
    expect(objectView.kind).toBe("operation")
    let compared = 0
    for (const item of objectView.listItems) {
      expect(new Set(item.selection.cellKeys)).toEqual(new Set(item.selection.cells.map(graphCellKey)))
      const selectedEvidence = new Set(item.selection.cells.flatMap(cell => cell.evidenceIds))
      for (const id of item.selection.evidenceIds) expect(selectedEvidence.has(id), `object evidence ${id} belongs to a server authority cell`).toBe(true)
      for (const cell of item.selection.cells) {
        const authority = authorityCell(cell.idn, cell.op, cell.resource)!
        expect(cell.evidenceIds).toEqual(authority.evidenceIds)
        const judgment = sample.authorizationMatrix!.objects.find((object) => object.identity === cell.idn && object.operation === cell.op && object.resource === cell.resource)
        if (cell.resource && judgment) {
          expect(findJudgmentItem(sample.authorizationMatrix!, judgment.id)?.evidenceIds).toEqual(authority.evidenceIds)
          expect(judgment.evidenceIds).toEqual(authority.evidenceIds)
          compared += 1
        }
        const legacy = projectMatrix(sample, "identity", false).rows.flatMap((row) => Object.values(row.membersByColumn).flat()).find((member) => member.identity === cell.idn && member.cell.op === cell.op && member.cell.resource === cell.resource)!
        expect(legacy.cell.evidenceIds).toEqual(authority.evidenceIds)
      }
    }
    expect(compared).toBeGreaterThan(0)
    for (const id of objectView.listItems.flatMap((item) => item.selection.evidenceIds)) expect(eventIds.has(id), `graph 요청 기록 ${id} is a server event`).toBe(true)
  })

  it("keeps route candidates neutral across the graph and the surface", () => {
    const candidates = projectRouteCandidates(sample, { ...filters, includeRouteCandidates: true })
    expect(candidates.length).toBe(sample.routeCandidates.length)
    for (const candidate of candidates) {
      expect(candidate.selection.identity).toBeNull()
      expect(candidate.selection.resource).toBeNull()
      for (const id of candidate.selection.evidenceIds) expect(eventIds.has(id), `route candidate provenance ${id} is a server event`).toBe(true)
    }
    const site = projectHierarchy(sample, { ...filters, includeRouteCandidates: true }, { level: "site", groupId: "", operation: "", operationLimit: 18, objectLimit: 18, focusCandidateKey: "" })
    expect(site.groups.reduce((sum, group) => sum + group.routeCandidateCount, 0)).toBe(sample.routeCandidates.length)
  })
})
