import { describe, expect, it } from "vitest"
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

  it("keeps distinguishing coordinate suffixes within the visual card width", () => {
    const route = `/api/${"very-long-segment/".repeat(12)}orders/{id}`
    const svg = documentFor(card({ title: route }))
    const title = svg.querySelectorAll("text")[1].textContent!
    expect(title).toContain("…")
    expect(title.startsWith("/api/")).toBe(true)
    expect(title.endsWith("orders/{id}")).toBe(true)
    expect(title.length).toBeLessThan(30)
    const wide = documentFor(card({ kind: "target", icon: "box", title: `${"W".repeat(100)}:101` })).querySelectorAll("text")[1].textContent!
    expect(wide.endsWith(":101")).toBe(true)
    expect(wide.length).toBeLessThan(20)
  })

  it("accounts for wide lowercase glyphs when preserving a resource suffix", () => {
    const title = documentFor(card({ kind: "target", icon: "box", title: `${"m".repeat(100)}:101` })).querySelectorAll("text")[1].textContent!
    expect(title.endsWith(":101")).toBe(true)
    expect(title.length).toBeLessThanOrEqual(16)
  })

  it("escapes bounded visual text and retains no executable or external data", () => {
    const card: ParameterNodeCardView = {
      kind: "input", badge: "</text>", title: `한글 <tag> & \"quote\" ${"x".repeat(100)}`,
      detail: `<script>alert(1)</script>`, footer: `한글 <tag> & "quote"`, icon: "none",
      accessibleLabel: "the complete safe fallback label",
    }

    const image = renderParameterNodeCardSvg(card)
    const svg = decodeURIComponent(image.uri.replace("data:image/svg+xml,", ""))
    expect(image).toMatchObject({ width: 224, height: 124 })
    expect(svg).toContain("한글 &lt;tag&gt; &amp; &quot;quote&quot;")
    expect(svg).toContain("&lt;/text&gt;")
    expect(svg).toContain("&lt;script&gt;alert(1)&lt;/script&gt;")
    expect(svg).not.toContain("<script")
    expect(svg).not.toMatch(/(?:href|src)=["'][^"']*https?:/i)
    expect(svg).not.toContain("<image")
    expect(svg).not.toContain("the complete safe fallback label")
    expect(svg).not.toContain("x".repeat(100))
    expect((svg.match(/<text\b/g) ?? []).length).toBe(4)
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
