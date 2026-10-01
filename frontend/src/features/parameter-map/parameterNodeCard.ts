import type { SurfaceParameter, SurfaceParameterGap } from "@/lib/api/types"
import { stripOrigin } from "@/lib/display/operationLabel"
import { wrapPath } from "@/lib/display/pathLines"
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
  /** 관측된 응답 코드(API 노드). 카드 아래에 코드만 뱃지로 그린다. 개수는 그리지 않는다. */
  statuses?: readonly number[]
  /** 서버 판정이 IDOR·BFLA 후보(SUSPICIOUS)인 셀 수. 0보다 크면 카드 오른쪽 위에 빨간 점과 "후보 N"을 그린다. */
  candidates?: number
}

export type CardSource = "human" | "scanner" | "llm"

export type CardTheme = "dark" | "light"

/** 카드 색. 다크는 기존 값 그대로, 라이트는 같은 색상군의 옅은 배경·진한 글자로 흰 캔버스에서 읽히게 한다. */
const cardPalettes = {
  dark: {
    card: "#111418", stroke: "#64748b", title: "#f8fafc", detail: "#cbd5e1", footer: "#94a3b8",
    user: "#93c5fd", box: "#c4b5fd", relation: "#5eead4", badge: ["#334155", "#cbd5e1"] as const,
    source: { human: "#60a5fa", scanner: "#f87171", llm: "#facc15" } as Record<CardSource, string>,
  },
  light: {
    card: "#ffffff", stroke: "#94a3b8", title: "#0f172a", detail: "#334155", footer: "#64748b",
    user: "#2563eb", box: "#7c3aed", relation: "#0d9488", badge: ["#e2e8f0", "#334155"] as const,
    source: { human: "#2563eb", scanner: "#dc2626", llm: "#ca8a04" } as Record<CardSource, string>,
  },
}

/** Cytoscape 노드 바탕색. 카드 SVG 모서리 밖으로 비치는 색을 카드와 맞춘다. */
export function cardSurface(theme: CardTheme): string { return cardPalettes[theme].card }

/** 16px 상자 안의 주체 아이콘: HUMAN 사람, SCANNER 스캐너(조준 틀), LLM 로봇. */
const sourceIconPaths: Record<CardSource, string> = {
  human: '<circle cx="8" cy="5" r="3"/><path d="M2.5 15v-1.5a5.5 5.5 0 0 1 11 0V15"/>',
  scanner: '<path d="M1 5V1h4M11 1h4v4M15 11v4h-4M5 15H1v-4"/><path d="M4 8h8"/>',
  llm: '<g stroke-linejoin="round"><rect x="2" y="5" width="12" height="9" rx="2"/><path d="M8 5V2"/><circle cx="8" cy="1.5" r=".6"/><path d="M5.5 9v1M10.5 9v1"/></g>',
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

/** 점검 우선순위 카드는 배지·제목만 그린다. 역할·Gap 종류·값 형태·HTTP 결과·owner는 접근 이름(마우스 설명)과 상세 패널에 남긴다. */
export function conditionNodeCard(gap: SurfaceParameterGap, parameter: SurfaceParameter | undefined): ParameterNodeCardView {
  const identity = gap.identity ?? "UNKNOWN", role = gap.role ?? "UNKNOWN"
  const observations = gap.identity ? parameter?.profile?.identityCounts[gap.identity] ?? 0 : 0
  return {
    kind: "condition", badge: "IDENTITY", title: identity, detail: "", footer: "", icon: "user",
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
    kind: "operation", badge: key.method, title: stripOrigin(key.pathTemplate) || key.pathTemplate, detail: "", footer: "", icon: "none",
    accessibleLabel: `Operation ${stripOrigin(key.operation) || key.operation}; ${result}; 관측 기록 ${statuses.length}건`,
  }
}

export function inputNodeCard(key: ParameterMapKey, gap: SurfaceParameterGap, parameter: SurfaceParameter | undefined): ParameterNodeCardView {
  const shape = known(parameter?.observedShapes[0], shapes), valueType = known(parameter?.observedValueTypes[0], valueTypes)
  const gapType = gapTypeLabels[gap.type]
  const badge = locationLabel(key.location)
  const title = stripOrigin(parameter?.fieldPath || key.canonicalPath) || key.canonicalPath

  return {
    kind: "input", badge, title, detail: "", footer: "", icon: "none",
    accessibleLabel: `Input ${badge} ${key.canonicalPath}; ${gapType}; ${shape} · ${valueType}`,
  }
}

export function targetNodeCard(resource: string | null, confidence: string, owner: string | null, service = ""): ParameterNodeCardView {
  const title = resource ? resourceLabel(resource, service) : "UNKNOWN", targetOwner = owner ?? "UNKNOWN"
  return {
    kind: "target", badge: "RESOURCE", title, detail: "", footer: "", icon: "box",
    accessibleLabel: `Authorization target ${resource ?? "UNKNOWN"}; ${confidence}; owner: ${targetOwner}`,
  }
}

const SVG_WIDTH = 200
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
// Conservative glyph widths keep wide Latin/CJK characters inside the card when fonts cannot be measured.
const estimatedGlyphWidth = (character: string, fontSize: number) => fontSize * (/[MWmw@#%&]|[^ -~]/u.test(character) ? 1 : /[A-Z]/.test(character) ? 0.8 : 0.65)
/**
 * 브라우저에서는 카드 SVG와 같은 sans-serif로 글자 폭을 실제로 잰다. 어림값은 실제보다 25~30% 넓어서
 * 카드 오른쪽이 비어 있는데도 제목이 일찍 다음 줄로 넘어갔다. 렌더러 차이로 잘리지 않게 5%만 여유를 둔다.
 */
const measureContext = typeof OffscreenCanvas === "undefined" ? null : new OffscreenCanvas(1, 1).getContext("2d")
const measuredGlyphs = new Map<string, number>()
const glyphWidth = (character: string, fontSize: number) => {
  if (!measureContext) return estimatedGlyphWidth(character, fontSize)
  const key = `${fontSize}\u0000${character}`
  let width = measuredGlyphs.get(key)
  if (width === undefined) {
    measureContext.font = `${fontSize}px sans-serif`
    width = measureContext.measureText(character).width * 1.05
    measuredGlyphs.set(key, width)
  }
  return width
}
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

const badgeColors: Record<CardTheme, Record<string, readonly [string, string]>> = {
  dark: {
    GET: ["#1e3a5f", "#93c5fd"], POST: ["#064e3b", "#6ee7b7"], PATCH: ["#78350f", "#fcd34d"],
    PUT: ["#4c1d95", "#c4b5fd"], DELETE: ["#7f1d1d", "#fca5a5"], HEAD: ["#164e63", "#67e8f9"], OPTIONS: ["#334155", "#cbd5e1"],
    PATH: ["#1e3a5f", "#93c5fd"], QUERY: ["#164e63", "#67e8f9"], JSON: ["#064e3b", "#6ee7b7"],
    FORM: ["#78350f", "#fcd34d"], GRAPHQL: ["#4c1d95", "#c4b5fd"], MULTIPART: ["#134e4a", "#5eead4"], XML: ["#7c2d12", "#fdba74"], HEADER: ["#3f3f46", "#e4e4e7"],
  },
  light: {
    GET: ["#dbeafe", "#1e40af"], POST: ["#d1fae5", "#065f46"], PATCH: ["#fef3c7", "#92400e"],
    PUT: ["#ede9fe", "#5b21b6"], DELETE: ["#fee2e2", "#991b1b"], HEAD: ["#cffafe", "#155e75"], OPTIONS: ["#e2e8f0", "#334155"],
    PATH: ["#dbeafe", "#1e40af"], QUERY: ["#cffafe", "#155e75"], JSON: ["#d1fae5", "#065f46"],
    FORM: ["#fef3c7", "#92400e"], GRAPHQL: ["#ede9fe", "#5b21b6"], MULTIPART: ["#ccfbf1", "#115e59"], XML: ["#ffedd5", "#9a3412"], HEADER: ["#f4f4f5", "#3f3f46"],
  },
}

/** 제목은 최대 두 줄. 경로는 `/` 경계로 나누고 넘치면 앞을 줄여 끝(자원·ID)을 남긴다. 일반 글자는 폭에 맞춰 나눈다. */
function titleLines(title: string, width: number, maxLines = 2): string[] {
  const safe = xmlSafeText(title)
  const fits = (line: string) => textWidth(line, TITLE_FONT) <= width
  if (fits(safe)) return [safe]
  if (safe.startsWith("/")) return wrapPath(safe, fits, maxLines).map(line => visualLine(line, width, TITLE_FONT, true))
  const lines: string[] = []
  let rest = safe
  while (lines.length < maxLines - 1 && !fits(rest)) {
    let line = ""
    for (const character of Array.from(rest)) { if (!fits(line + character)) break; line += character }
    if (!line) break
    // 단어 중간이 아니라 마지막 공백에서 나눈다. 공백이 없을 때만 글자 단위로 자른다.
    const space = line.lastIndexOf(" ")
    if (space > 0) line = line.slice(0, space + 1)
    lines.push(line.trimEnd())
    rest = rest.slice(line.length)
  }
  return [...lines, visualLine(rest, width, TITLE_FONT, true)]
}

const TITLE_BASELINE = 53, TITLE_FONT = 15, LINE_GAP = 19, ROW_GAP = 22, BOTTOM_PADDING = 14
/** 응답 코드 뱃지 줄: 높이 18 뱃지 + 제목과의 간격. 5개를 넘으면 4개와 "+N"만 그린다. */
const STATUS_ROW = 28, STATUS_BADGE_HEIGHT = 18, STATUS_FONT = 11, STATUS_LIMIT = 5
const statusNeutral: Record<CardTheme, { stroke: string; text: string }> = { dark: { stroke: "#334155", text: "#94a3b8" }, light: { stroke: "#cbd5e1", text: "#64748b" } }

/** 응답 코드 뱃지. 평소에는 무채색이고, statusColors에 있는(필터로 고른) 코드만 그 색으로 칠한다. */
function statusBadges(statuses: readonly number[], top: number, theme: CardTheme, statusColors?: ReadonlyMap<number, string>): string {
  const shown = statuses.length > STATUS_LIMIT ? statuses.slice(0, STATUS_LIMIT - 1) : statuses
  const labels = [...shown.map(String), ...(statuses.length > STATUS_LIMIT ? [`+${statuses.length - shown.length}`] : [])]
  let x = 14
  return labels.map((label, index) => {
    const color = index < shown.length ? statusColors?.get(shown[index]) : undefined
    const badgeWidth = Math.ceil(textWidth(label, STATUS_FONT) + 12)
    const fill = color ? `fill="${color}" fill-opacity="0.15"` : 'fill="none"'
    const badge = `<rect x="${x}" y="${top}" width="${badgeWidth}" height="${STATUS_BADGE_HEIGHT}" rx="5" ${fill} stroke="${color ?? statusNeutral[theme].stroke}"/><text x="${x + badgeWidth / 2}" y="${top + 13}" text-anchor="middle" fill="${color ?? statusNeutral[theme].text}" font-family="monospace" font-size="${STATUS_FONT}">${escapeXml(label)}</text>`
    x += badgeWidth + 6
    return badge
  }).join("")
}

/** Bounded inline display image only; full text remains in DOM tooltips and fallback labels. */
export function renderParameterNodeCardSvg(card: ParameterNodeCardView, compact = false, size?: { width: number; height: number }, theme: CardTheme = "dark", statusColors?: ReadonlyMap<number, string>): { uri: string; width: number; height: number } {
  const palette = cardPalettes[theme]
  // size는 사용자가 모서리를 끌어 정한 크기다. 기본보다 작게는 그리지 않고, 늘어난 높이는 제목 줄 수로 쓴다.
  const width = Math.max(compact ? 232 : SVG_WIDTH, size?.width ?? 0)
  const rows = [card.detail, card.footer].filter(Boolean)
  const statusRow = card.statuses?.length ? STATUS_ROW : 0
  const titleX = card.icon === "none" ? 14 : 38
  const titleWidth = width - titleX - 14
  // 기본 높이: 관계 그래프(compact)는 실제 제목 줄 수에 맞추고, 점검 우선순위 카드는 두 줄 자리를 고정해 모두 같은 크기로 둔다.
  const titleSlots = compact ? titleLines(card.title, titleWidth).length : 2
  const lastTitleBaseline = TITLE_BASELINE + LINE_GAP * (titleSlots - 1)
  const defaultHeight = (rows.length ? lastTitleBaseline + ROW_GAP * rows.length : lastTitleBaseline) + statusRow + BOTTOM_PADDING
  const height = Math.max(defaultHeight, size?.height ?? 0)
  // 보조 줄과 응답 코드 뱃지 줄은 카드 아래에 붙이고, 그 위 공간에 들어가는 만큼 제목 줄을 쓴다(사용자가 키운 카드는 더 많은 줄).
  const rowBaseline = (index: number) => height - BOTTOM_PADDING - statusRow - ROW_GAP * (rows.length - 1 - index)
  const titleLimit = rows.length ? rowBaseline(0) - ROW_GAP : height - BOTTOM_PADDING - statusRow
  const maxTitleLines = Math.max(titleSlots, Math.floor((titleLimit - TITLE_BASELINE) / LINE_GAP) + 1)
  const lines = titleLines(card.title, titleWidth, maxTitleLines)
  // 두 줄 자리를 고정한 카드에서 한 줄 제목은 그 자리의 세로 가운데에 둔다.
  const titleOffset = !compact && lines.length === 1 ? LINE_GAP / 2 : 0
  // 왼쪽 아이콘은 80%로 줄여 제목 첫 줄 높이에 맞춘다.
  const iconTransform = `translate(23 ${TITLE_BASELINE + titleOffset - 5}) scale(0.8) translate(-23 -45)`
  const sources = cardSourceOrder.filter(source => card.sources?.includes(source))
  const alertLabel = card.candidates ? `후보 ${card.candidates}` : ""
  const alertWidth = alertLabel ? Math.ceil(textWidth(alertLabel, 11) + 26) : 0
  const badge = visualLine(card.badge, width - 46 - sources.length * 22 - (alertWidth ? alertWidth + 8 : 0), 12)
  const badgeWidth = Math.ceil(textWidth(badge, 12) + 18)
  // 주체 아이콘은 배지(METHOD) 오른쪽에 나란히 둔다.
  const sourceIcons = sources.map((source, index) => `<g transform="translate(${14 + badgeWidth + 8 + index * 22} 12)"><g fill="none" stroke="${palette.source[source]}" stroke-width="1.6" stroke-linecap="round">${sourceIconPaths[source]}</g></g>`).join("")
  const [background, foreground] = (card.kind === "operation" || card.kind === "input") && Object.hasOwn(badgeColors[theme], card.badge) ? badgeColors[theme][card.badge] : palette.badge
  const icon = card.icon === "user" ? `<g fill="none" stroke="${palette.user}" stroke-width="2" stroke-linecap="round" transform="` + iconTransform + '"><circle cx="23" cy="40" r="4"/><path d="M15 54v-2a8 8 0 0 1 16 0v2"/></g>'
    : card.icon === "box" ? `<g fill="none" stroke="${palette.box}" stroke-width="2" stroke-linejoin="round" transform="` + iconTransform + '"><path d="M14 40l9-5 9 5v10l-9 5-9-5Z"/><path d="m14 40 9 5 9-5M23 45v10m-4.5-17.5 9 5"/></g>' : ""
  const relationshipIcon = card.icon === "globe" ? `<g fill="none" stroke="${palette.relation}" stroke-width="2" stroke-linecap="round" transform="` + iconTransform + '"><circle cx="23" cy="45" r="10"/><path d="M13 45h20"/><path d="M23 35c3 3 4.5 6.4 4.5 10S26 52 23 55M23 35c-3 3-4.5 6.4-4.5 10S20 52 23 55"/></g>'
    : card.icon === "network" ? `<g fill="none" stroke="${palette.relation}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" transform="` + iconTransform + '"><circle cx="23" cy="36" r="3"/><circle cx="15" cy="52" r="3"/><circle cx="31" cy="52" r="3"/><path d="m21.5 38.7-5 10.6m8-10.6 5 10.6"/><path d="M18 52h10"/></g>' : ""
  const title = lines.map((line, index) => `<text x="${titleX}" y="${TITLE_BASELINE + titleOffset + index * LINE_GAP}" fill="${palette.title}" font-family="sans-serif" font-size="${TITLE_FONT}">${escapeXml(line)}</text>`).join("")
  const rowText = rows.map((value, index) => `<text x="14" y="${rowBaseline(index)}" fill="${index === 0 && card.detail ? palette.detail : palette.footer}" font-family="sans-serif" font-size="12">${escapeXml(visualLine(value, width - 28, 12, index > 0 || !card.detail))}</text>`).join("")
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true"><rect width="${width}" height="${height}" rx="10" fill="${palette.card}" stroke="${palette.stroke}"/><g><rect x="14" y="9" width="${badgeWidth}" height="22" rx="5" fill="${background}"/><text x="${14 + badgeWidth / 2}" y="24" text-anchor="middle" fill="${foreground}" font-family="sans-serif" font-size="12">${escapeXml(badge)}</text></g>${sourceIcons}${alertLabel ? `<g><rect x="${width - 12 - alertWidth}" y="9" width="${alertWidth}" height="22" rx="11" fill="${theme === "dark" ? "#450a0a" : "#fee2e2"}" stroke="#ef4444"/><circle cx="${width - 12 - alertWidth + 11}" cy="20" r="3" fill="${theme === "dark" ? "#fca5a5" : "#b91c1c"}"/><text x="${width - 12 - alertWidth + 19}" y="24" fill="${theme === "dark" ? "#fca5a5" : "#b91c1c"}" font-family="sans-serif" font-size="11" font-weight="600">${escapeXml(alertLabel)}</text></g>` : ""}${icon}${relationshipIcon}${title}${rowText}${statusRow ? statusBadges(card.statuses ?? [], height - BOTTOM_PADDING - STATUS_BADGE_HEIGHT, theme, statusColors) : ""}</svg>`
  return { uri: `data:image/svg+xml,${encodeURIComponent(svg)}`, width, height }
}
