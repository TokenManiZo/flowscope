import { render, screen } from "@testing-library/react"
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
