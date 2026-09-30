import { STATUS_CLASS_COLOR, statusClass } from "./graphHighlight"

/** 메서드 색은 Swagger UI 관례(GET 파랑·POST 초록·PUT 주황·PATCH 보라·DELETE 빨강)를 따른다. */
const METHOD_COLOR: Record<string, string> = { GET: "#378ADD", POST: "#1D9E75", PUT: "#BA7517", PATCH: "#7F77DD", DELETE: "#E24B4A" }

export function MethodBadge({ method }: { method: string }) {
  const color = METHOD_COLOR[method] ?? "#94a3b8"
  return <span className="inline-block whitespace-nowrap rounded border px-1.5 py-0.5 font-mono text-[13px] font-semibold" style={{ color, background: `${color}24`, borderColor: `${color}80` }}>{method}</span>
}

/** 응답 코드 뱃지. 색은 그래프 강조와 같은 계열 색(2xx 초록·3xx 파랑·4xx 주황·5xx 빨강)이다. */
export function StatusBadge({ code }: { code: number }) {
  const color = STATUS_CLASS_COLOR[statusClass(code)]
  return <span className="rounded px-1 font-mono text-[13px]" style={{ color, background: `${color}22` }}>{code}</span>
}
