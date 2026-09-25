import { describe, expect, it } from "vitest"

import { pathAfterGroup, wrapPath } from "./pathLines"

const within = (limit: number) => (line: string) => line.length <= limit

describe("wrapPath", () => {
  it("keeps a short path on one line and wraps at slash boundaries", () => {
    expect(wrapPath("/api/orders/{id}", within(30))).toEqual(["/api/orders/{id}"])
    expect(wrapPath("/workshop/api/shop/orders/{id}", within(20))).toEqual(["/workshop/api/shop", "/orders/{id}"])
  })

  it("trims the front with an ellipsis when two lines are not enough and keeps the tail", () => {
    const lines = wrapPath("/community/api/v2/community/posts/7weVqm2Pmn3gC6T2gdzpm4", within(26))
    expect(lines).toHaveLength(2)
    expect(lines[0].startsWith("…/")).toBe(true)
    expect(lines.join("")).toMatch(/\/posts\/7weVqm2Pmn3gC6T2gdzpm4$/)
  })

  it("falls back to the last segment when even that does not fit", () => {
    expect(wrapPath("/a/very-long-segment-name", within(5), 1)).toEqual(["…/very-long-segment-name"])
  })
})

describe("pathAfterGroup", () => {
  it("drops the prefix up to the API group segment", () => {
    expect(pathAfterGroup("/workshop/api/shop/orders/{id}")).toBe("/api/shop/orders/{id}")
    expect(pathAfterGroup("/api/v2/community/posts/recent")).toBe("/posts/recent")
    expect(pathAfterGroup("/orders")).toBe("/orders")
    expect(pathAfterGroup("/api/orders/{id}")).toBe("/api/orders/{id}")
  })
})
