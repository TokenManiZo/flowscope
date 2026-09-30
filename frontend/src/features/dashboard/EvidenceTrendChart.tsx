import type { EventRecord } from "@/lib/api/types"

const BUCKETS = 16
const WIDTH = 1000
const HEIGHT = 280
const TOP = 20
const BOTTOM = 26

export interface TrendPoint { human: number; scanner: number; llm: number; timestamp: number }

export function buildEvidenceTrend(events: readonly EventRecord[]): readonly TrendPoint[] {
  const included = events.filter((event) => event.source === "human" || event.source === "scanner" || event.source === "llm").sort((a, b) => a.timestamp - b.timestamp)
  if (!included.length) return Array.from({ length: BUCKETS }, () => ({ human: 0, scanner: 0, llm: 0, timestamp: 0 }))
  const firstTimestamp = included[0].timestamp
  const lastTimestamp = included.at(-1)!.timestamp
  const span = lastTimestamp - firstTimestamp
  const buckets = Array.from({ length: BUCKETS }, (_, index) => ({
    human: 0,
    scanner: 0,
    llm: 0,
    timestamp: span > 0 ? firstTimestamp + (span * index) / (BUCKETS - 1) : firstTimestamp,
  }))
  for (const event of included) {
    const index = span > 0
      ? Math.min(BUCKETS - 1, Math.floor(((event.timestamp - firstTimestamp) / span) * (BUCKETS - 1)))
      : 0
    if (event.source === "human") buckets[index].human += 1
    if (event.source === "scanner") buckets[index].scanner += 1
    if (event.source === "llm") buckets[index].llm += 1
  }
  for (let index = 1; index < buckets.length; index += 1) {
    buckets[index].human += buckets[index - 1].human
    buckets[index].scanner += buckets[index - 1].scanner
    buckets[index].llm += buckets[index - 1].llm
  }
  return buckets
}

function coordinates(points: readonly TrendPoint[], key: "human" | "scanner" | "llm", max: number) {
  const drawableHeight = HEIGHT - TOP - BOTTOM
  const firstTimestamp = points[0]?.timestamp ?? 0
  const lastTimestamp = points.at(-1)?.timestamp ?? firstTimestamp
  const span = lastTimestamp - firstTimestamp
  return points.map((point, index) => ({
    x: span > 0 ? ((point.timestamp - firstTimestamp) / span) * WIDTH : (index / (points.length - 1)) * WIDTH,
    y: TOP + drawableHeight - (point[key] / max) * drawableHeight,
  }))
}

function linePath(points: readonly { x: number; y: number }[]): string {
  return points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ")
}

function areaPath(points: readonly { x: number; y: number }[]): string {
  return points.length ? `${linePath(points)} L${WIDTH},${HEIGHT - BOTTOM} L0,${HEIGHT - BOTTOM} Z` : ""
}

function timeLabel(timestamp: number): string {
  if (timestamp < 100_000) return "-"
  return new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit" }).format(timestamp)
}

export function EvidenceTrendChart({ events }: { events: readonly EventRecord[] }) {
  const points = buildEvidenceTrend(events)
  const max = Math.max(1, ...points.flatMap((point) => [point.human, point.scanner, point.llm]))
  const human = coordinates(points, "human", max)
  const scanner = coordinates(points, "scanner", max)
  const llm = coordinates(points, "llm", max)
  const labels = [0, Math.floor((points.length - 1) / 2), points.length - 1]
  const labelPositions = coordinates(points, "human", max)

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-5 text-xs text-muted-foreground"><span className="flex items-center gap-2"><span className="h-0.5 w-5 rounded-full bg-zinc-100" />HUMAN</span><span className="flex items-center gap-2"><span className="h-0.5 w-5 rounded-full bg-emerald-400" />ZAP</span><span className="flex items-center gap-2"><span className="h-0.5 w-5 rounded-full bg-sky-400" />LLM</span></div>
      <svg role="img" aria-label="HUMAN, ZAP, LLM 관측 기록 수집 추이" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" className="h-[260px] w-full overflow-visible sm:h-[320px]">
        <title>HUMAN, ZAP, LLM 관측 기록 수집 추이</title>
        {[0, 1, 2, 3, 4].map((line) => { const y = TOP + ((HEIGHT - TOP - BOTTOM) * line) / 4; return <line key={line} x1="0" x2={WIDTH} y1={y} y2={y} stroke="currentColor" className="text-white/[0.07]" strokeDasharray="3 6" vectorEffect="non-scaling-stroke" /> })}
        <path d={areaPath(human)} fill="rgb(244 244 245 / 0.08)" />
        <path d={areaPath(scanner)} fill="rgb(52 211 153 / 0.08)" />
        <path d={areaPath(llm)} fill="rgb(56 189 248 / 0.06)" />
        <path d={linePath(human)} fill="none" stroke="rgb(244 244 245)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        <path d={linePath(scanner)} fill="none" stroke="rgb(52 211 153)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
        <path d={linePath(llm)} fill="none" stroke="rgb(56 189 248)" strokeWidth="2" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" />
        {labels.map((index) => <text key={index} x={labelPositions[index].x} y={HEIGHT - 5} textAnchor={index === 0 ? "start" : index === points.length - 1 ? "end" : "middle"} fill="currentColor" className="text-[11px] text-muted-foreground">{timeLabel(points[index].timestamp)}</text>)}
      </svg>
    </div>
  )
}
