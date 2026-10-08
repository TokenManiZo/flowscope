import { expect, it } from "vitest"
import { readableGraphViewport } from "./graphViewport"

it("keeps the same readable zoom when the observation graph grows vertically", () => {
  const first = [{ x: 200, y: 200, width: 240, height: 80 }, { x: 540, y: 100, width: 280, height: 120 }, { x: 900, y: 100, width: 280, height: 120 }]
  const short = readableGraphViewport(first, 1000)!
  const tall = readableGraphViewport([...first, ...Array.from({ length: 100 }, (_, i) => ({ x: 540, y: 300 + i * 140, width: 280, height: 120 }))], 1000)!
  expect(tall).toEqual(short)
  expect(tall.zoom).toBeGreaterThanOrEqual(0.65)
  expect(40 * tall.zoom + tall.pan.y).toBe(64)
})

it("does not overzoom small graphs or frame an unmeasured canvas", () => {
  expect(readableGraphViewport([{ x: 540, y: 500, width: 200, height: 80 }], 1600)?.zoom).toBe(1)
  expect(readableGraphViewport([], 1000)).toBeNull()
  expect(readableGraphViewport([{ x: 540, y: 500, width: 200, height: 80 }], 0)).toBeNull()
})
