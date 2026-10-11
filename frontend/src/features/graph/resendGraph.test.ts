import { expect, it } from "vitest"

import type { EventRecord, ManualVerification } from "@/lib/api/types"
import { targetSnapshot } from "@/test/fixtures"
import { isObservedTraffic, navigateHierarchy, type GraphNavigation } from "./graphHierarchy"
import { projectResendGraph, resendSends } from "./resendGraph"
import { relationshipNodeCard } from "./relationshipNodeCard"

const service = "https://demo.test:443"
const op = (method: string, path: string) => `${service} ${method} ${path}`
const initial: GraphNavigation = { level: "site", groupId: "", operation: "", operationLimit: 18, objectLimit: 18, focusCandidateKey: "" }
const event = (overrides: Partial<EventRecord>): EventRecord => ({ eventId: "e", method: "GET", path: "/api/orders/101", status: 200, fp: "", idn: "user-a", role: "USER", source: "human", op: op("GET", "/api/orders/{id}"), resource: "orders:101", timestamp: 1, sourceDetail: "BROWSER", orchestrator: "HUMAN", tool: "BROWSER", phase: "EXPLORATION", executionTrust: "OBSERVED", runId: "run-1", authState: "AUTH", trafficClass: "API", trafficDisposition: "INCLUDE", coverageEligible: true, classificationOverride: false, classificationReasons: [], pathTemplateStatus: "CORROBORATED", pathTemplateReasons: [], clusterId: "c", repeatCount: 1, firstSeen: 1, lastSeen: 1, clusterEvidenceIds: [], objects: [], verdict: "untested", ...overrides })
const lab = (overrides: Partial<ManualVerification>): ManualVerification => ({ eventId: "lab-1", originEvidenceId: "orig-1", operation: op("PATCH", "/api/orders/{id}"), resource: "orders:101", identity: "user-b", identityId: "user-b", timestamp: 5, status: 403, durationMs: 10, ...overrides })

const snapshot = () => targetSnapshot({
  owners: { "orders:101": "user-a" },
  events: [
    event({ eventId: "orig-1", method: "PATCH", op: op("PATCH", "/api/orders/{id}"), status: 204 }),
    event({ eventId: "rep-1", idn: "user-b", sourceDetail: "BURP_REPEATER", phase: "BASELINE", trafficDisposition: "EXCLUDE", resource: "orders:202", path: "/api/orders/202", timestamp: 3 }),
    event({ eventId: "rep-2", idn: "user-b", sourceDetail: "BURP_REPEATER", phase: "BASELINE", trafficDisposition: "EXCLUDE", resource: "orders:202", path: "/api/orders/202", status: 403, timestamp: 4 }),
    event({ eventId: "intr-1", idn: "user-b", sourceDetail: "BURP_INTRUDER", phase: "BASELINE", trafficDisposition: "EXCLUDE", timestamp: 2 }),
  ],
  manualVerifications: [lab({}), lab({ eventId: "lab-2", originEvidenceId: "gone", identityId: "anon", identity: "anon", operation: op("GET", "/api/profile"), resource: null, status: 401, timestamp: 6 })],
})

it("pairs Request Lab sends with their original response and never guesses a Repeater original", () => {
  expect(resendSends(snapshot()).map(send => [send.tool, send.eventId, send.originalStatus, send.status])).toEqual([
    ["repeater", "rep-1", null, 200], ["repeater", "rep-2", null, 403], ["lab", "lab-1", 204, 403], ["lab", "lab-2", null, 401],
  ])
})

it("keeps Repeater and Intruder sends out of the collected graph", () => {
  const events = snapshot().events
  expect(events.filter(isObservedTraffic).map(item => item.eventId)).toEqual(["orig-1"])
})

it("draws sender identity, resent API per tool and object with tool-coloured dashed edges and no verdict cells", () => {
  const graph = projectResendGraph(snapshot(), initial, "source", ["lab", "repeater"])
  expect(graph.navigation).toBe(initial)
  expect(graph.nodes.find(node => node.id === "identity:anon")).toMatchObject({ label: "비로그인", wrappedLabel: "비로그인", selection: { identity: "anon" } })
  expect(graph.nodes.map(node => node.id).sort()).toEqual([
    "identity:anon", "identity:user-b",
    `resend-operation:lab:${op("GET", "/api/profile")}`, `resend-operation:lab:${op("PATCH", "/api/orders/{id}")}`, `resend-operation:repeater:${op("GET", "/api/orders/{id}")}`,
    "resource:orders:101", "resource:orders:202",
  ].sort())
  expect(graph.nodes.every(node => node.selection.cells.length === 0)).toBe(true)
  const repeater = graph.nodes.find(node => node.id === `resend-operation:repeater:${op("GET", "/api/orders/{id}")}`)!
  expect(repeater).toMatchObject({ resend: { tool: "repeater", count: 2, status: 403, originalStatus: null }, selection: { evidenceIds: ["rep-1", "rep-2"] } })
  expect(graph.edges.find(edge => edge.targetId === repeater.id)).toMatchObject({ relation: "resend", source: null, line: "dashed", color: "#D85A30", countLabel: "×2" })
  expect(graph.nodes.find(node => node.id === "resource:orders:101")?.owner).toBe("user-a")

  const labOnly = projectResendGraph(snapshot(), navigateHierarchy(initial, "site"), "source", ["lab"])
  expect(labOnly.nodes.some(node => node.kind === "resend-operation" && node.resend?.tool === "repeater")).toBe(false)
  expect(projectResendGraph(snapshot(), initial, "source", []).nodes.every(node => node.kind === "identity")).toBe(true)
})

it("shows the original-to-resend comparison for Request Lab and only the response for Repeater on cards", () => {
  const graph = projectResendGraph(snapshot(), initial, "source", ["lab", "repeater"])
  const card = (id: string) => relationshipNodeCard(graph.nodes.find(node => node.id === id)!, graph)
  expect(card(`resend-operation:lab:${op("PATCH", "/api/orders/{id}")}`)).toMatchObject({ badge: "REQUEST LAB · PATCH", title: "/api/orders/{id}", detail: "원본 204 → 403", footer: "" })
  expect(card(`resend-operation:lab:${op("GET", "/api/profile")}`)).toMatchObject({ detail: "원본 기록 없음 → 401" })
  expect(card(`resend-operation:repeater:${op("GET", "/api/orders/{id}")}`)).toMatchObject({ badge: "REPEATER · GET", detail: "응답 403 · 원본 없음", footer: "2회 전송 · 최근 기준" })
})
