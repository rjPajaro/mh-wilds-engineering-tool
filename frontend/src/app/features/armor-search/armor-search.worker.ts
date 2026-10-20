import { ArmorSearchInput, ArmorSearchOutput, searchArmorSets, SearchProgress } from '../../core/search/armor-search';
import { CharmSearchInput, CharmSearchOutput, searchCharms } from '../../core/search/charm-search';
import { DamageSearchInput, searchDamageSets } from '../../core/search/damage-search';

// Only types may be imported from this file: importing it runs the listener below.
export type ArmorSearchRequest =
  | { kind: 'sets'; input: ArmorSearchInput }
  | { kind: 'damage'; input: DamageSearchInput }
  | { kind: 'charms'; input: CharmSearchInput };

/** Progress messages while the search runs, then one with the output. */
export type ArmorSearchMessage = { type: 'progress'; progress: SearchProgress } | { type: 'done'; output: ArmorSearchOutput | CharmSearchOutput };

/** Runs one request (the service does the same inline when workers are unavailable). */
function runSearch(request: ArmorSearchRequest, onProgress?: (progress: SearchProgress) => void): ArmorSearchOutput | CharmSearchOutput {
  if (request.kind === 'damage') return searchDamageSets(request.input, onProgress);
  if (request.kind === 'charms') return searchCharms(request.input, onProgress);
  return searchArmorSets(request.input, onProgress);
}

// Runs an armor set search off the main thread; one request in, progress and the output out.
addEventListener('message', ({ data }: MessageEvent<ArmorSearchRequest>) => {
  const send = (message: ArmorSearchMessage) => postMessage(message);
  const onProgress = (progress: SearchProgress) => send({ type: 'progress', progress });
  send({ type: 'done', output: runSearch(data, onProgress) });
});
