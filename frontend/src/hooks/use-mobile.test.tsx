import { act, render, screen } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"

import { useIsMobile } from "./use-mobile"

function mediaQueryList(initialMatches: boolean) {
  let matches = initialMatches
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  return {
    get matches() { return matches },
    addEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener)),
    removeEventListener: vi.fn((_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener)),
    listenerCount: () => listeners.size,
    setMatches(next: boolean) {
      matches = next
      const event = { matches: next } as MediaQueryListEvent
      listeners.forEach((listener) => listener(event))
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

it("uses matchMedia on the first render, follows changes, and removes its listener on unmount", () => {
  const media = mediaQueryList(true)
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue(media))
  const renderStates: boolean[] = []

  function Probe() {
    const mobile = useIsMobile()
    renderStates.push(mobile)
    return <output>{mobile ? "mobile" : "desktop"}</output>
  }

  const view = render(<Probe />)
  expect(renderStates[0]).toBe(true)
  expect(screen.getByText("mobile")).toBeVisible()
  expect(media.listenerCount()).toBe(1)

  act(() => media.setMatches(false))
  expect(screen.getByText("desktop")).toBeVisible()

  view.unmount()
  expect(media.listenerCount()).toBe(0)
})
