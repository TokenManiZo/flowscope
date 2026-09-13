import { describe, expect, it } from "vitest"
import { clampParameterNode, parameterLaneGeometry } from "./parameterLanes"

describe("four-lane rendered rectangle constraints", () => {
  it("clamps node centers including half-width, not just centers to lane boundaries", () => {
    const lane = parameterLaneGeometry(1200, "input", 224)
    expect(lane).toMatchObject({ laneLeft: 600, laneRight: 900, left: 724, right: 776, anchor: 750, nodeWidth: 224 })
    expect(clampParameterNode({ x: 2000, y: 80 }, lane)).toEqual({ x: 776, y: 80 })
    expect(clampParameterNode({ x: -1, y: 80 }, lane)).toEqual({ x: 724, y: 80 })
  })
  it.each([0.1, 0.5, 1, 2, 5])("fits full rectangles at zoom %s, returning a capped zoom when necessary", zoom => {
    for (const width of [320, 900, 1200, 1920]) for (const name of ["condition", "operation", "input", "target"] as const) {
      const lane = parameterLaneGeometry(width, name, 186, zoom)
      for (const x of [-10000, 0, 10000]) {
        const position = clampParameterNode({ x, y: 50 }, lane)
        expect(position.x - lane.nodeWidth / 2).toBeGreaterThanOrEqual(lane.laneLeft)
        expect(position.x + lane.nodeWidth / 2).toBeLessThanOrEqual(lane.laneRight)
      }
      expect(lane.zoom).toBeLessThanOrEqual(zoom)
    }
  })
  it("flags narrow list fallback and handles invalid dimensions/positions with finite bounds", () => {
    expect(parameterLaneGeometry(899, "input", 186).fallback).toBe(true)
    expect(parameterLaneGeometry(900, "input", 186).fallback).toBe(false)
    for (const width of [0, -1, NaN, Infinity]) {
      const lane = parameterLaneGeometry(width, "target", Infinity, NaN)
      expect(lane).toMatchObject({ laneLeft: 0, laneRight: 0, left: 0, right: 0, nodeWidth: 0, fallback: true })
      expect(clampParameterNode({ x: NaN, y: Infinity }, lane)).toEqual({ x: 0, y: 0 })
    }
  })
})
