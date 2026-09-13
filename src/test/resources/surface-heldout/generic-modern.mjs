import transport from 'axios';
const base = '/service';
export async function load(entryId) {
  const state = globalThis?.application?.state;
  await fetch(`${base}/entries/${entryId}?include=owner&locale=ko`);
  return transport.post(base + '/entries/search', {
    criteria: {status: state, labels: ['new']},
    cursor: null
  });
}
