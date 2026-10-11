import { expect, it } from "vitest"
import { pathShape } from "./graphPathShape"

it("keeps alphabetic routes and versions literal while accepting short mixed and numeric IDs", () => {
  expect(pathShape("/api/unsplash/")).toBe("/api/unsplash/")
  expect(pathShape("/api/timezones/")).toBe("/api/timezones/")
  expect(pathShape("/items/aaaaaaaaaaaaaaaa")).toBe("/items/aaaaaaaaaaaaaaaa")
  expect(pathShape("/items/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")).toBe("/items/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
  expect(pathShape("/api/v2/orders/ORD-123")).toBe("/api/v2/orders/{id}")
  expect(pathShape("/items/abc123/")).toBe("/items/{id}/")
  expect(pathShape("/101")).toBe("/{id}")
})
it("decodes candidate values within raw segments without changing URL structure", () => {
  expect(pathShape("/items/%61%62%63")).toBe("/items/%61%62%63")
  expect(pathShape("/items/%61%62%63%31")).toBe("/items/{id}")
  expect(pathShape("/items/A%2FB")).toBe("/items/A%2FB")
  expect(pathShape("/items/abc+123")).toBe("/items/abc+123")
  expect(pathShape("/items/%broken")).toBe("/items/%broken")
})
