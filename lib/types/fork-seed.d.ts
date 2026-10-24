/**
 * Exact port of `buildForkSeed` from @deepseek-ai/dsh-session 0.2.1-rc.2
 * (`lib/types/fork.js` + `lib/types/repair.js`), inlined so the Host face
 * keeps zero runtime dsh imports. Only the `forked` closer cause is ported;
 * the `interrupted` texts are unused here.
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session';
/**
 * Core `buildForkSeed`: copy an inclusive event prefix, mark its inherited
 * cut, and close its open tail with forked results and step/turn endings.
 * Closed steps and turns are preserved unchanged.
 *
 * @param events - source log with contiguous seqs from zero.
 * @param boundary - inclusive source event seq the side chat inherits through.
 * @returns the source prefix objects, the marker, then synthetic closers; the
 *   inherited prefix counted by `inheritedEventCount` is `boundary + 1`.
 */
export declare function buildForkSeed(events: readonly SessionEvent[], boundary: number): SessionEvent[];
