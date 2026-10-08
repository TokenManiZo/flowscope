import type { SurfaceEndpoint } from "@/lib/api/types"

/** 서비스 origin과 경로 템플릿을 합쳐 한 줄짜리 URL로 만든다. 경로가 이미 절대 URL이면 그대로 쓴다. */
export function endpointUrl(key: SurfaceEndpoint["key"]): string {
  const path = key.pathTemplate.trim()
  if (/^https?:\/\//i.test(path)) return path
  const origin = key.service.trim().replace(/\/+$/, "")
  if (!origin) return path
  return `${origin}${path.startsWith("/") ? "" : "/"}${path}`
}

/**
 * 선택한 API들을 URL 목록 텍스트로 만든다. 같은 URL은 한 번만, 보기 좋게 정렬한다.
 * 메서드가 달라도 URL이 같으면 한 줄로 합친다(씨앗 URL 목록이므로).
 */
export function buildUrlList(endpoints: readonly SurfaceEndpoint[]): string {
  const urls = [...new Set(endpoints.map((endpoint) => endpointUrl(endpoint.key)).filter(Boolean))]
  urls.sort((left, right) => left.localeCompare(right))
  return urls.length ? urls.join("\n") + "\n" : ""
}

/** 브라우저에서 텍스트를 파일로 내려받는다. 저장소가 막힌 환경에서도 오류로 작업을 멈추지 않는다. */
export function downloadText(filename: string, text: string): boolean {
  try {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = filename
    document.body.append(anchor)
    anchor.click()
    anchor.remove()
    // 일부 브라우저는 클릭 직후 revoke하면 저장이 끊긴다. 다음 틱으로 미룬다.
    setTimeout(() => URL.revokeObjectURL(url), 0)
    return true
  } catch {
    return false
  }
}
