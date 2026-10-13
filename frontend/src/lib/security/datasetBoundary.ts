// A local lifecycle signal only: no dataset identifier or server contract is invented.
export const DATASET_REPLACING = "flowscope:dataset-replacing"
export const DATASET_WILL_REPLACE = "flowscope:dataset-will-replace"
export async function prepareDatasetReplacement() {
  const pending: Promise<unknown>[] = []
  window.dispatchEvent(new CustomEvent(DATASET_WILL_REPLACE, { detail: { waitUntil: (promise: Promise<unknown>) => pending.push(promise) } }))
  await Promise.all(pending)
}
export function notifyDatasetReplacing() { window.dispatchEvent(new Event(DATASET_REPLACING)) }

/** A successful open/create starts a fresh project viewing session; traffic reset does not. */
export const PROJECT_OPENED = "flowscope:project-opened"
export function notifyProjectOpened() { window.dispatchEvent(new Event(PROJECT_OPENED)) }
