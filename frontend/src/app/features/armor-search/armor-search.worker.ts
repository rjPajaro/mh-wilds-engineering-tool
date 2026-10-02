import { ArmorSearchInput, searchArmorSets } from '../../core/search/armor-search';

// Runs the armor set search off the main thread; one message in, one out.
addEventListener('message', ({ data }: MessageEvent<ArmorSearchInput>) => {
  postMessage(searchArmorSets(data));
});
