// A local lifecycle signal only: no dataset identifier or server contract is invented.
export const DATASET_REPLACING = "flowscope:dataset-replacing"
export function notifyDatasetReplacing() { window.dispatchEvent(new Event(DATASET_REPLACING)) }
