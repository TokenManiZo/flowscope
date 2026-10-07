import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, it } from "vitest"
import { EvidenceHttpViewer } from "./EvidenceHttpViewer"

it("reads retained messages with CRLF header/body separation and independent pane choices", async () => {
  const user = userEvent.setup()
  render(<EvidenceHttpViewer request={'PATCH /settings HTTP/1.1\r\nAuthorization: [MASKED]\r\n\r\n{"flag":true}'} response={'HTTP/2 200 OK\r\n\r\n{"flag":true}'} />)
  const request = screen.getByRole("textbox", { name: "요청 원문" })
  const response = screen.getByRole("textbox", { name: "응답 원문" })
  expect(request).toHaveAttribute("readonly")
  await user.click(screen.getByRole("button", { name: "요청 헤더" }))
  expect(request).toHaveValue('PATCH /settings HTTP/1.1\nAuthorization: [MASKED]')
  expect(response).toHaveValue('HTTP/2 200 OK\n\n{"flag":true}')
  await user.click(screen.getByRole("button", { name: "요청 본문" }))
  expect(request).toHaveValue('{"flag":true}')
  await user.selectOptions(screen.getByRole("combobox", { name: "관측 원문 글자 크기" }), "16")
  expect(request).toHaveStyle({fontSize:"16px"})
  const divider = screen.getByRole("separator", { name: "요청 응답 너비 조절" })
  fireEvent.keyDown(divider, {key:"ArrowRight"})
  expect(divider).toHaveAttribute("aria-valuenow","52")
  await user.click(screen.getByRole("button", { name: "줄바꿈" }))
  expect(request).toHaveClass("whitespace-pre-wrap")
  await user.click(screen.getByRole("button", { name: "원문 확대" }))
  expect(screen.getByRole("dialog", { name: "요청·응답 확대" })).toBeVisible()
  expect(screen.getByRole("textbox", { name: "요청 원문" })).toHaveValue('{"flag":true}')
  await user.keyboard("{Escape}")
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  expect(screen.getByRole("button", { name: "원문 확대" })).toHaveFocus()
})
