import { describe, expect, it, vi } from "vitest"
import type { ParameterNodeCardView } from "./parameterNodeCard"
import { renderParameterNodeCardSvg } from "./parameterNodeCard"

describe("parameter node card SVG", () => {
  const card = (extra: Partial<ParameterNodeCardView> = {}): ParameterNodeCardView => ({ kind: "operation", badge: "GET", title: "/orders/{id}", detail: "HTTP 200 × 1", footer: "1 Evidence", icon: "none", accessibleLabel: "Operation full coordinate", ...extra })
  const documentFor = (value: ParameterNodeCardView) => new DOMParser().parseFromString(decodeURIComponent(renderParameterNodeCardSvg(value).uri.replace("data:image/svg+xml,", "")), "image/svg+xml")

  it("draws user and resource icons from inline SVG geometry", () => {
    const user = documentFor(card({ kind: "condition", badge: "IDENTITY", icon: "user" }))
    const box = documentFor(card({ kind: "target", badge: "RESOURCE", icon: "box" }))
    expect(user.querySelector("g circle")).not.toBeNull()
    expect(user.querySelector("g path")).not.toBeNull()
    expect(box.querySelectorAll("g path").length).toBeGreaterThanOrEqual(2)
    for (const svg of [user, box]) expect(svg.querySelector("image, use, script, foreignObject, parsererror")).toBeNull()
  })

  it("draws target and API-group icons as bounded inline geometry", () => {
    const globe = documentFor(card({ kind: "target", badge: "TARGET", icon: "globe" }))
    const network = documentFor(card({ kind: "target", badge: "API GROUP", icon: "network" }))

    expect(globe.querySelectorAll("g circle").length).toBeGreaterThanOrEqual(1)
    expect(globe.querySelectorAll("g path").length).toBeGreaterThanOrEqual(2)
    expect(network.querySelectorAll("g circle").length).toBe(3)
    expect(network.querySelectorAll("g path").length).toBeGreaterThanOrEqual(2)
    for (const svg of [globe, network]) expect(svg.querySelector("image, use, script, foreignObject, parsererror")).toBeNull()
  })

  it.each([
    ["operation", "GET", "#1e3a5f", "#93c5fd"],
    ["operation", "POST", "#064e3b", "#6ee7b7"],
    ["operation", "PATCH", "#78350f", "#fcd34d"],
    ["operation", "DELETE", "#7f1d1d", "#fca5a5"],
    ["input", "PATH", "#1e3a5f", "#93c5fd"],
    ["input", "QUERY", "#164e63", "#67e8f9"],
    ["input", "JSON", "#064e3b", "#6ee7b7"],
    ["input", "FORM", "#78350f", "#fcd34d"],
    ["input", "GRAPHQL", "#4c1d95", "#c4b5fd"],
  ] as const)("renders a bounded colored %s %s badge with legible text", (kind, badge, background, foreground) => {
    const svg = documentFor(card({ kind, badge }))
    const label = [...svg.querySelectorAll("text")].find(text => text.textContent === badge)!
    const shape = label.parentElement?.querySelector("rect")
    expect(shape).not.toBeNull()
    expect(shape?.getAttribute("fill")).toBe(background)
    expect(Number(shape?.getAttribute("width"))).toBeGreaterThan(24)
    expect(Number(shape?.getAttribute("width"))).toBeLessThanOrEqual(196)
    expect(Number(shape?.getAttribute("rx"))).toBeGreaterThan(0)
    expect(label.getAttribute("fill")).toBe(foreground)
  })

  const titleLines = (svg: Document) => [...svg.querySelectorAll("text")].filter(text => text.getAttribute("font-size") === "15").map(text => text.textContent!)

  it("wraps a long route at slash boundaries into two lines and trims the front to keep the suffix", () => {
    const route = `/api/${"very-long-segment/".repeat(12)}orders/{id}`
    const lines = titleLines(documentFor(card({ title: route })))
    expect(lines).toHaveLength(2)
    expect(lines[0].startsWith("…/")).toBe(true)
    expect(lines[1].endsWith("orders/{id}")).toBe(true)
    expect(titleLines(documentFor(card({ title: "/api/orders/{id}" })))).toEqual(["/api/orders/{id}"])
    const wide = titleLines(documentFor(card({ kind: "target", icon: "box", title: `${"W".repeat(100)}:101` })))
    expect(wide).toHaveLength(2)
    expect(wide[1].endsWith(":101")).toBe(true)
  })

  it("uses measured font widths so a title that fits the card is not wrapped early", async () => {
    class MeasuringCanvas { getContext() { return { font: "", measureText: (text: string) => ({ width: text.length * 7 }) } } }
    vi.stubGlobal("OffscreenCanvas", MeasuringCanvas)
    vi.resetModules()
    try {
      const measured = await import("./parameterNodeCard")
      const title = "abcdefghijklmnopqrstuv"
      const compact = (render: typeof renderParameterNodeCardSvg) => new DOMParser().parseFromString(decodeURIComponent(render(card({ kind: "target", icon: "box", title }), true).uri.replace("data:image/svg+xml,", "")), "image/svg+xml")
      expect(titleLines(compact(measured.renderParameterNodeCardSvg))).toEqual([title])
      expect(titleLines(compact(renderParameterNodeCardSvg))).toHaveLength(2)
    } finally {
      vi.unstubAllGlobals()
      vi.resetModules()
    }
  })

  it("breaks a plain title at a space instead of mid-word", () => {
    const words = ["orders", "items", "coupon", "refund"]
    const lines = titleLines(documentFor(card({ kind: "target", icon: "box", title: words.join(" ") })))
    expect(lines.length).toBe(2)
    expect(lines.flatMap(line => line.split(" "))).toEqual(words)
  })

  it("accounts for wide lowercase glyphs when preserving a resource suffix", () => {
    const lines = titleLines(documentFor(card({ kind: "target", icon: "box", title: `${"m".repeat(100)}:101` })))
    expect(lines[1].endsWith(":101")).toBe(true)
    expect(lines.every(line => line.length <= 16)).toBe(true)
  })

  it("escapes bounded visual text and retains no executable or external data", () => {
    const card: ParameterNodeCardView = {
      kind: "input", badge: "</text>", title: `한글 <tag> & \"quote\" ${"x".repeat(100)}`,
      detail: `<script>alert(1)</script>`, footer: `한글 <tag> & "quote"`, icon: "none",
      accessibleLabel: "the complete safe fallback label",
    }

    const image = renderParameterNodeCardSvg(card)
    const svg = decodeURIComponent(image.uri.replace("data:image/svg+xml,", ""))
    expect(image).toMatchObject({ width: 200, height: 130 })
    expect(svg).toContain("한글 &lt;tag&gt; &amp; &quot;quote&quot;")
    expect(svg).toContain("&lt;/text&gt;")
    // 폭 200px 카드에서는 상세 문자열이 잘릴 수 있다. 잘려도 태그는 항상 이스케이프된다.
    expect(svg).toContain("&lt;script&gt;alert(1)")
    expect(svg).not.toContain("<script")
    expect(svg).not.toMatch(/(?:href|src)=["'][^"']*https?:/i)
    expect(svg).not.toContain("<image")
    expect(svg).not.toContain("the complete safe fallback label")
    expect(svg).not.toContain("x".repeat(100))
    // 배지 1 · 두 줄 제목 2 · 상세 1 · 푸터 1
    expect((svg.match(/<text\b/g) ?? []).length).toBe(5)
  })

  it.each([
    ["a lone high surrogate", "\uD800"],
    ["a lone low surrogate", "\uDC00"],
    ["NUL", "\u0000"],
    ["other forbidden C0 controls", "\u0001\u000B\u001F"],
  ])("normalizes %s before creating an inline SVG", (_name, malformed) => {
    const card: ParameterNodeCardView = {
      kind: "input", badge: "JSON", title: `before${malformed}after`, detail: "detail", footer: "footer", icon: "none",
      accessibleLabel: "safe fallback",
    }

    expect(() => renderParameterNodeCardSvg(card)).not.toThrow()
    const image = renderParameterNodeCardSvg(card)
    const svg = decodeURIComponent(image.uri.replace("data:image/svg+xml,", ""))
    expect(svg).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF]/)
    expect(svg).toContain(`before${"�".repeat(Array.from(malformed).length)}after`)
  })
})

describe("source icons beside the badge", () => {
  const card: ParameterNodeCardView = { kind: "operation", badge: "GET", title: "/api/orders/{id}", detail: "", footer: "", icon: "none", accessibleLabel: "op", sources: ["human", "scanner"] }
  const svg = (view: ParameterNodeCardView, compact = true) => decodeURIComponent(renderParameterNodeCardSvg(view, compact).uri.replace(/^data:image\/svg\+xml,/, ""))

  it("draws the icons on the badge row and drops the detail row height", () => {
    const text = svg(card)
    expect(text).toMatch(/translate\(\d+ 12\)/)
    expect(text).not.toMatch(/translate\(\d+ 65\)/)
    // 관계 그래프 카드는 실제 제목 줄 수에 맞춘다(한 줄 67 · 보조 한 줄 추가 89).
    expect(renderParameterNodeCardSvg(card, true)).toMatchObject({ width: 232, height: 67 })
    expect(renderParameterNodeCardSvg({ ...card, footer: "owner: A" }, true).height).toBe(89)
    // 점검 우선순위 카드는 보조 줄이 비어도 한 줄 자리를 둬 같은 크기다.
    expect(renderParameterNodeCardSvg(card)).toMatchObject({ width: 200, height: 86 })
  })

  it("draws the detail row when present, grows compact cards by it, and keeps Gap graph cards one size", () => {
    const withDetail = { ...card, detail: "owner: USER B" }
    expect(renderParameterNodeCardSvg(withDetail, true).height).toBe(89)
    expect(renderParameterNodeCardSvg(withDetail).height).toBe(108)
    expect(renderParameterNodeCardSvg({ ...withDetail, footer: "legacy footer" }).height).toBe(130)
    expect(svg(withDetail)).toContain("owner: USER B")
  })
})
