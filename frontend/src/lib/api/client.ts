import type { ApiErrorBody } from "./types"

const apiPrefix = "/api/"
const defaultStatuses = [200] as const

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = "ApiError"
  }
}

export type ApiFetch = <T>(
  path: `/api/${string}`,
  init?: RequestInit,
  expectedStatuses?: readonly number[],
) => Promise<T>

export type PostForm = <T>(
  path: `/api/${string}`,
  values: Record<string, string>,
  expectedStatuses?: readonly number[],
  signal?: AbortSignal,
) => Promise<T>

function capabilityHeader(path: string, headers: Headers): void {
  if (!path.startsWith(apiPrefix)) return
  const capability = document.querySelector<HTMLMetaElement>('meta[name="flowscope-capability"]')?.content ?? ""
  headers.set("X-FlowScope-Token", capability)
}

async function errorFor(response: Response): Promise<ApiError> {
  const fallback = `HTTP ${response.status}`
  let message = fallback
  try {
    const body: unknown = await response.json()
    if (isApiErrorBody(body)) message = body.message
  } catch {
    // A malformed or non-JSON server error must retain its HTTP status without exposing raw text.
  }
  return new ApiError(response.status, message)
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== "object" || value === null) return false
  const body = value as { success?: unknown; message?: unknown }
  return body.success === false && typeof body.message === "string"
}

async function decodeSuccess<T>(response: Response): Promise<T> {
  try {
    return await response.json() as T
  } catch {
    throw new ApiError(response.status, "응답 JSON을 읽을 수 없습니다.")
  }
}

export const apiFetch: ApiFetch = async (path, init = {}, expectedStatuses = defaultStatuses) => {
  const headers = new Headers(init.headers)
  capabilityHeader(path, headers)
  const response = await fetch(path, { ...init, headers })
  if (!expectedStatuses.includes(response.status)) throw await errorFor(response)
  return decodeSuccess(response)
}

export const postForm: PostForm = (path, values, expectedStatuses = defaultStatuses, signal) => {
  const headers = new Headers({ "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" })
  return apiFetch(path, {
    method: "POST",
    headers,
    body: new URLSearchParams(values),
    signal,
  }, expectedStatuses)
}
