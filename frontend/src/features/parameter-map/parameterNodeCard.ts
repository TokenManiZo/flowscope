import type { SurfaceParameter, SurfaceParameterGap } from "@/lib/api/types"
import { stripOrigin } from "@/lib/display/operationLabel"
import type { ParameterMapKey } from "./parameterProjection"


export type ParameterNodeCardKind = "condition" | "operation" | "input" | "target"
export interface ParameterNodeCardView {
  kind: ParameterNodeCardKind
  badge: string
  title: string
  detail: string
  footer: string
  icon: "user" | "none" | "box" | "globe" | "network"
  accessibleLabel: string
  /** 이 노드에 접근한 탐지 주체. 있으면 배지 옆에 주체별 아이콘을 그리고 상세 줄은 빼서 카드를 낮춘다(API·Object 노드). */
  sources?: readonly CardSource[]
}

export type CardSource = "human" | "scanner" | "llm"

/** 16px 상자 안의 주체 아이콘: HUMAN 사람, SCANNER 스캐너(조준 틀), LLM 로봇. */
const sourceIconPaths: Record<CardSource, string> = {
  human: '<g fill="none" stroke="#60a5fa" stroke-width="1.6" stroke-linecap="round"><circle cx="8" cy="5" r="3"/><path d="M2.5 15v-1.5a5.5 5.5 0 0 1 11 0V15"/></g>',
  scanner: '<g fill="none" stroke="#f87171" stroke-width="1.6" stroke-linecap="round"><path d="M1 5V1h4M11 1h4v4M15 11v4h-4M5 15H1v-4"/><path d="M4 8h8"/></g>',
  llm: '<g fill="none" stroke="#e4e4e7" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="12" height="9" rx="2"/><path d="M8 5V2"/><circle cx="8" cy="1.5" r=".6"/><path d="M5.5 9v1M10.5 9v1"/></g>',
}
const cardSourceOrder: readonly CardSource[] = ["human", "scanner", "llm"]

const locationLabels: Record<string, string> = {
  PATH: "PATH", QUERY: "QUERY", FORM_BODY: "FORM", JSON_BODY: "JSON",
  GRAPHQL_VARIABLE: "GRAPHQL", MULTIPART_BODY: "MULTIPART", XML_PATH: "XML", HEADER: "HEADER",
}
export function locationLabel(location: string): string { return locationLabels[location] ?? location }
const gapTypeLabels: Record<SurfaceParameterGap["type"], string> = {
  DEFINED_NOT_OBSERVED: "Defined not observed",
  SOURCE_MISSED: "Source missed",
  IDENTITY_MISSED: "Identity missed",
  AUTH_VARIANT_UNTESTED: "Authorization variant untested",
  CONDITION_COMBINATION_UNOBSERVED: "Condition combination unobserved",
  TYPE_VARIANT_UNOBSERVED: "Type variant unobserved",
}
const shapes = new Set(["EMPTY", "STRING", "INTEGER", "DECIMAL", "BOOLEAN", "UUID", "ARRAY", "OBJECT", "NULL", "BINARY", "UNKNOWN"])
const valueTypes = new Set(["STRING", "INTEGER", "NUMBER", "BOOLEAN", "UUID", "DATE_TIME", "BINARY", "UNKNOWN"])

function known(value: string | undefined, values: Set<string>): string {
  return value && values.has(value) ? value : "UNKNOWN"
}

/** 표시용 리소스 라벨: endpoint와 같은 service 접두와 오리진은 뺀다(machine key는 그대로). */
export function resourceLabel(resource: string, service: string): string {
  const withoutService = resource.startsWith(`${service} `) ? resource.slice(service.length + 1) : resource
  return stripOrigin(withoutService) || withoutService
}


export function conditionNodeCard(gap: SurfaceParameterGap, parameter: SurfaceParameter | undefined): ParameterNodeCardView {
  const identity = gap.identity ?? "UNKNOWN", role = gap.role ?? "UNKNOWN"
  const observations = gap.identity ? parameter?.profile?.identityCounts[gap.identity] ?? 0 : 0
  return {
    kind: "condition", badge: "IDENTITY", title: identity, detail: role, footer: `${observations} observations`, icon: "user",
    accessibleLabel: `Condition identity ${identity}; role ${role}; ${observations} observations`,
  }
}

export function operationNodeCard(key: ParameterMapKey, statuses: readonly number[]): ParameterNodeCardView {
  const counts = new Map<number, number>()
  for (const value of statuses) {
    const status = Number.isInteger(value) && value >= 100 && value <= 599 ? value : 0
    counts.set(status, (counts.get(status) ?? 0) + 1)
  }
  const result = statuses.length ? `HTTP ${[...counts].sort(([left], [right]) => (left || 600) - (right || 600)).map(([status, count]) => `${status || "UNKNOWN"} × ${count}`).join(" · ")}` : "HTTP UNKNOWN · no observations"
  return {
    kind: "operation", badge: key.method, title: stripOrigin(key.pathTemplate) || key.pathTemplate, detail: result, footer: `${statuses.length} Evidence`, icon: "none",

    accessibleLabel: `Operation ${stripOrigin(key.operation) || key.operation}; ${result}; ${statuses.length} Evidence`,
  }
}

export function inputNodeCard(key: ParameterMapKey, gap: SurfaceParameterGap, parameter: SurfaceParameter | undefined): ParameterNodeCardView {
  const shape = known(parameter?.observedShapes[0], shapes), valueType = known(parameter?.observedValueTypes[0], valueTypes)
  const gapType = gapTypeLabels[gap.type]
  const badge = locationLabel(key.location)
  const title = stripOrigin(parameter?.fieldPath || key.canonicalPath) || key.canonicalPath

  return {
    kind: "input", badge, title, detail: gapType, footer: `${shape} · ${valueType}`, icon: "none",
    accessibleLabel: `Input ${badge} ${key.canonicalPath}; ${gapType}; ${shape} · ${valueType}`,
  }
}

export function targetNodeCard(resource: string | null, confidence: string, owner: string | null, service = ""): ParameterNodeCardView {
  const title = resource ? resourceLabel(resource, service) : "UNKNOWN", targetOwner = owner ?? "UNKNOWN"
  return {
    kind: "target", badge: "RESOURCE", title, detail: confidence, footer: `owner: ${targetOwner}`, icon: "box",
    accessibleLabel: `Authorization target ${resource ?? "UNKNOWN"}; ${confidence}; owner: ${targetOwner}`,
  }
}

const SVG_WIDTH = 224, SVG_HEIGHT = 124
const escapeXml = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]!)
const xml10Character = (codePoint: number) => codePoint === 0x9 || codePoint === 0xA || codePoint === 0xD
  || codePoint >= 0x20 && codePoint <= 0xD7FF || codePoint >= 0xE000 && codePoint <= 0xFFFD || codePoint >= 0x10000 && codePoint <= 0x10FFFF
function xmlSafeText(value: string): string {
  let safe = ""
  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index)
    if (codeUnit >= 0xD800 && codeUnit <= 0xDBFF) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xDC00 && next <= 0xDFFF) {
        const codePoint = (codeUnit - 0xD800) * 0x400 + next - 0xDC00 + 0x10000
        safe += xml10Character(codePoint) ? String.fromCodePoint(codePoint) : "�"
        index++
      } else safe += "�"
      continue
    }
    if (codeUnit >= 0xDC00 && codeUnit <= 0xDFFF) { safe += "�"; continue }
    safe += xml10Character(codeUnit) ? String.fromCharCode(codeUnit) : "�"
  }
  return safe
}
// Conservative glyph widths keep wide Latin/CJK characters inside the card without measuring fonts.
const glyphWidth = (character: string, fontSize: number) => fontSize * (/[MWmw@#%&]|[^ -~]/u.test(character) ? 1 : /[A-Z]/.test(character) ? 0.8 : 0.65)
const textWidth = (value: string, fontSize: number) => Array.from(value).reduce((width, character) => width + glyphWidth(character, fontSize), 0)
const visualLine = (value: string, width: number, fontSize: number, preserveEnd = false) => {
  const safe = xmlSafeText(value), codePoints = Array.from(safe)
  if (textWidth(safe, fontSize) <= width) return safe
  const take = (characters: string[], budget: number) => {
    let used = 0, result = ""
    for (const character of characters) {
      used += glyphWidth(character, fontSize)
      if (used > budget) break
      result += character
    }
    return result
  }
  const budget = width - fontSize
  if (!preserveEnd) return `${take(codePoints, budget)}…`
  const start = take(codePoints, budget * 0.35)
  const end = Array.from(take([...codePoints].reverse(), budget - textWidth(start, fontSize))).reverse().join("")
  return `${start}…${end}`
}

const badgeColors: Record<string, readonly [string, string]> = {
  GET: ["#1e3a5f", "#93c5fd"], POST: ["#064e3b", "#6ee7b7"], PATCH: ["#78350f", "#fcd34d"],
  PUT: ["#4c1d95", "#c4b5fd"], DELETE: ["#7f1d1d", "#fca5a5"], HEAD: ["#164e63", "#67e8f9"], OPTIONS: ["#334155", "#cbd5e1"],
  PATH: ["#1e3a5f", "#93c5fd"], QUERY: ["#164e63", "#67e8f9"], JSON: ["#064e3b", "#6ee7b7"],
  FORM: ["#78350f", "#fcd34d"], GRAPHQL: ["#4c1d95", "#c4b5fd"], MULTIPART: ["#134e4a", "#5eead4"], XML: ["#7c2d12", "#fdba74"], HEADER: ["#3f3f46", "#e4e4e7"],
}

/** Bounded inline display image only; full text remains in DOM tooltips and fallback labels. */
export function renderParameterNodeCardSvg(card: ParameterNodeCardView, compact = false): { uri: string; width: number; height: number } {
  const width = compact ? 196 : SVG_WIDTH
  // 아이콘 모드(sources)이거나 상세 글자가 없으면 상세 줄을 빼고 그 높이만큼 카드를 줄인다.
  const detailRow = card.sources || !card.detail ? 0 : compact ? 22 : 25
  const height = (compact ? card.footer ? 86 : 66 : SVG_HEIGHT - 25) + detailRow
  const titleX = card.icon === "none" ? 14 : 42
  const sources = cardSourceOrder.filter(source => card.sources?.includes(source))
  const badge = visualLine(card.badge, width - 46 - sources.length * 22, 12)
  const badgeWidth = Math.ceil(textWidth(badge, 12) + 18)
  // 주체 아이콘은 배지(METHOD) 오른쪽에 나란히 둔다.
  const sourceIcons = sources.map((source, index) => `<g transform="translate(${14 + badgeWidth + 8 + index * 22} 12)">${sourceIconPaths[source]}</g>`).join("")
  const [background, foreground] = (card.kind === "operation" || card.kind === "input") && Object.hasOwn(badgeColors, card.badge) ? badgeColors[card.badge] : ["#334155", "#cbd5e1"]
  const icon = card.icon === "user" ? '<g fill="none" stroke="#93c5fd" stroke-width="1.8" stroke-linecap="round"><circle cx="23" cy="40" r="4"/><path d="M15 54v-2a8 8 0 0 1 16 0v2"/></g>'
    : card.icon === "box" ? '<g fill="none" stroke="#c4b5fd" stroke-width="1.8" stroke-linejoin="round"><path d="M14 40l9-5 9 5v10l-9 5-9-5Z"/><path d="m14 40 9 5 9-5M23 45v10m-4.5-17.5 9 5"/></g>' : ""
  const relationshipIcon = card.icon === "globe" ? '<g fill="none" stroke="#5eead4" stroke-width="1.8" stroke-linecap="round"><circle cx="23" cy="45" r="10"/><path d="M13 45h20"/><path d="M23 35c3 3 4.5 6.4 4.5 10S26 52 23 55M23 35c-3 3-4.5 6.4-4.5 10S20 52 23 55"/></g>'
    : card.icon === "network" ? '<g fill="none" stroke="#5eead4" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="23" cy="36" r="3"/><circle cx="15" cy="52" r="3"/><circle cx="31" cy="52" r="3"/><path d="m21.5 38.7-5 10.6m8-10.6 5 10.6"/><path d="M18 52h10"/></g>' : ""
  const title = escapeXml(visualLine(card.title, width - titleX - 14, 14, true))
  const detail = escapeXml(visualLine(card.detail, width - 28, 12))
  const footer = escapeXml(visualLine(card.footer, width - 28, 12, true))
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true"><rect width="${width}" height="${height}" rx="10" fill="#111418" stroke="#64748b"/><g><rect x="14" y="9" width="${badgeWidth}" height="22" rx="5" fill="${background}"/><text x="${14 + badgeWidth / 2}" y="24" text-anchor="middle" fill="${foreground}" font-family="sans-serif" font-size="12">${escapeXml(badge)}</text></g>${sourceIcons}${icon}${relationshipIcon}<text x="${titleX}" y="53" fill="#f8fafc" font-family="sans-serif" font-size="14">${title}</text>${card.sources || !card.detail ? "" : `<text x="14" y="78" fill="#cbd5e1" font-family="sans-serif" font-size="12">${detail}</text>`}${card.footer ? `<text x="14" y="${height - 14}" fill="#94a3b8" font-family="sans-serif" font-size="12">${footer}</text>` : ""}</svg>`
  return { uri: `data:image/svg+xml,${encodeURIComponent(svg)}`, width, height }
}
