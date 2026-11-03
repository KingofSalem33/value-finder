import { unstable_cache } from 'next/cache';
import { createSecService, readSec, memoryCache, type SourceCache } from './sec';

const cached: SourceCache = memoryCache();
const cache: SourceCache = (key, seconds, work) => cached(key, seconds, () => unstable_cache(work, ['sec-on-demand-1', key], { revalidate: seconds })());
export const secData = createSecService({ read: readSec, cache });
