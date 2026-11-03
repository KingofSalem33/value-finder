import { unstable_cache } from 'next/cache';
import { createSecService, readSec, memoryCache, compressedCache, type SourceCache } from './sec';

const cached: SourceCache = memoryCache();
const persistent: SourceCache = (key, seconds, work) => unstable_cache(work, ['sec-on-demand-2', key], { revalidate: seconds })();
const packed = compressedCache(persistent);
const cache: SourceCache = (key, seconds, work) => cached(key, seconds, () => packed(key, seconds, work));
export const secData = createSecService({ read: readSec, cache });
