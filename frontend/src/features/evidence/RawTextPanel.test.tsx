import { fireEvent, render, screen } from "@testing-library/react"
import { expect, it } from "vitest"

import { RawTextPanel } from "./RawTextPanel"

// 두 층의 글자 크기·줄 높이·여백이 다르면 커서가 보이는 글자와 어긋난다(md:text-sm이 남아 12.6px vs 10.8px였다).
const typography = /^(?:(?:md|lg):)?(?:text-(?:xs|sm|base)|leading-\S+|p[xytblr]?-\S+|font-mono|\[scrollbar-gutter:\S+\])$/

it("keeps the editable text and its highlight layer on the same typography", () => {
  render(<RawTextPanel id="raw" label="원문" value={"POST /a HTTP/1.1\nAuthorization: ***MASKED***"} />)
  const textarea = screen.getByRole("textbox", { name: "원문" })
  const highlight = textarea.previousElementSibling as HTMLElement
  const tokens = (element: Element) => [...element.classList].filter(name => typography.test(name)).sort()
  expect(tokens(textarea)).toEqual(tokens(highlight))
  expect(textarea).not.toHaveClass("md:text-sm", "px-2.5")
  // 굵기는 글꼴에 따라 글자 폭을 바꿀 수 있어 강조는 색만 쓴다.
  expect(highlight.querySelector(".font-semibold")).toBeNull()
})

it("keeps fill-mode typography and both scroll axes aligned without replacing the editor", () => {
  const props = { id: "raw-fill", label: "고정 원문", value: "GET /orders HTTP/1.1\n\n{}", fill: true }
  const view = render(<RawTextPanel {...props} fontSize={14} />)
  const textarea = screen.getByRole("textbox", { name: "고정 원문" }) as HTMLTextAreaElement
  const highlight = textarea.previousElementSibling as HTMLElement
  expect(textarea).toHaveStyle({ fontSize: "14px", lineHeight: "1.65" })
  expect(highlight).toHaveStyle({ fontSize: "14px", lineHeight: "1.65" })
  textarea.scrollTop = 80; textarea.scrollLeft = 20
  fireEvent.scroll(textarea)
  expect(highlight.scrollTop).toBe(80)
  expect(highlight.scrollLeft).toBe(20)
  textarea.setSelectionRange(4, 11)
  view.rerender(<RawTextPanel {...props} fontSize={18} />)
  expect(screen.getByRole("textbox", { name: "고정 원문" })).toBe(textarea)
  expect(textarea.selectionStart).toBe(4)
  expect(textarea.selectionEnd).toBe(11)
  expect(highlight).toHaveStyle({ fontSize: "18px", lineHeight: "1.65" })
})


it("preserves large Raw content while avoiding an unbounded syntax-token DOM", () => {
  const value = "Header: value\n".repeat(20_000)
  render(<RawTextPanel id="large-raw" label="큰 원문" value={value} readOnly fill />)
  const textarea = screen.getByRole("textbox", { name: "큰 원문" })
  const highlight = textarea.previousElementSibling as HTMLElement
  expect(textarea).toHaveValue(value)
  expect(highlight.textContent).toBe(value)
  expect(highlight.querySelectorAll("span")).toHaveLength(0)
})
