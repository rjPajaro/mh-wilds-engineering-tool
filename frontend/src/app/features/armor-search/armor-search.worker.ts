import { ArmorSearchInput, ArmorSearchOutput, searchArmorSets, SearchProgress } from '../../core/search/armor-search';
import { DamageSearchInput, searchDamageSets } from '../../core/search/damage-search';

// Only types may be imported from this file: importing it runs the listener below.
export type ArmorSearchRequest = { kind: 'sets'; input: ArmorSearchInput } | { kind: 'damage'; input: DamageSearchInput };

/** Progress messages while the search runs, then one with the output. */
export type ArmorSearchMessage = { type: 'progress'; progress: SearchProgress } | { type: 'done'; output: ArmorSearchOutput };

// Runs an armor set search off the main thread; one request in, progress and the output out.
addEventListener('message', ({ data }: MessageEvent<ArmorSearchRequest>) => {
  const send = (message: ArmorSearchMessage) => postMessage(message);
  const onProgress = (progress: SearchProgress) => send({ type: 'progress', progress });
  send({ type: 'done', output: data.kind === 'damage' ? searchDamageSets(data.input, onProgress) : searchArmorSets(data.input, onProgress) });
});
