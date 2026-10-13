/** Wildcard hosts are scope syntax, never passed through the browser URL parser. */
export const isWildcardScopeInput = (value: string) => /^(?:https?:\/\/)?(?:\*|%2a)\./i.test(value.trim())

export function normalizeStartUrl(raw: string): { url: string | null; note?: string } {
  const value = raw.trim()
  if (!value) return { url: null }
  if (isWildcardScopeInput(value)) return { url: null, note: "와일드카드는 스코프 범위에 추가하고 실제로 열 사이트 주소를 입력하세요." }
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`)
    if (url.protocol !== "http:" && url.protocol !== "https:") return { url: null, note: "http 또는 https 주소를 입력하세요." }
    if (url.username || url.password || url.hash || url.hostname.includes("*") || url.hostname.toLowerCase().includes("%2a")) return { url: null, note: "사용자정보·와일드카드·# 부분이 없는 사이트 주소를 입력하세요." }
    return { url: url.href }
  } catch { return { url: null, note: "실제로 열 사이트 주소를 입력하세요. 예: https://app.example.com/" } }
}

export function normalizeScopeEntry(raw: string): { entry: string | null; note?: string } {
  const value = raw.trim()
  if (!value) return { entry: null }
  const wildcard = isWildcardScopeInput(value)
  const candidate = wildcard ? value.replace(/^(https?:\/\/)?(?:\*|%2a)\./i, (_, scheme: string | undefined) => scheme ?? "") : value
  if (!candidate.includes("://") && /^[0-9.]+$/.test(candidate)) return { entry: null, note: "IP 주소에는 http 또는 https를 지정하세요." }
  let url: URL
  try { url = new URL(candidate.includes("://") ? candidate : `https://${candidate}`) }
  catch { return { entry: null, note: "스코프 주소 형식을 확인하세요." } }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { entry: null, note: "http 또는 https 주소만 등록할 수 있습니다." }
  if (url.username || url.password || url.hostname.includes("*") || url.hostname.toLowerCase().includes("%2a")) return { entry: null, note: "사용자정보가 없는 올바른 호스트 주소를 입력하세요." }
  const dns = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i
  if (wildcard && (!dns.test(url.hostname) || /^[0-9.]+$/.test(url.hostname) || url.hostname.length > 253 || url.hostname.split(".").some(label => label.length > 63))) return { entry: null, note: "와일드카드는 *.example.com 형식의 DNS 도메인에만 사용할 수 있습니다." }
  const port = url.port || (url.protocol === "https:" ? "443" : "80")
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "")
  return { entry: `${url.protocol}//${wildcard ? "*." : ""}${url.hostname}:${port}${path}`,
    note: wildcard ? `루트 도메인과 모든 하위 도메인을 ${url.protocol === "https:" ? "HTTPS" : "HTTP"} 범위로 등록했습니다.` : url.search || url.hash ? "쿼리와 뒷부분은 제외하고 등록했습니다." : undefined }
}

export function siteScope(url: string): string | null {
  const start = normalizeStartUrl(url).url
  return start ? normalizeScopeEntry(new URL(start).origin).entry : null
}
