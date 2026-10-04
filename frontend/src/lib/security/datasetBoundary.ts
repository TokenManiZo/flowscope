// A local lifecycle signal only: no dataset identifier or server contract is invented.
export const DATASET_REPLACING = "flowscope:dataset-replacing"
export const DATASET_WILL_REPLACE = "flowscope:dataset-will-replace"
export async function prepareDatasetReplacement() {
  const pending: Promise<unknown>[] = []
  window.dispatchEvent(new CustomEvent(DATASET_WILL_REPLACE, { detail: { waitUntil: (promise: Promise<unknown>) => pending.push(promise) } }))
  await Promise.all(pending)
}
export function notifyDatasetReplacing() { window.dispatchEvent(new Event(DATASET_REPLACING)) }
