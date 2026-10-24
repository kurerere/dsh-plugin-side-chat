/**
 * dsh-plugin-side-chat — Host face.
 *
 * A side chat is a hidden, read-only branch of one main Session:
 *
 * - It is seeded with the main Session up to now — the completed-turn prefix
 *   when idle, or everything so far with the open tail closed by forked
 *   closers while a turn is still running (the same seed `session.fork`
 *   builds) — so the model sees the conversation so far, but nothing it does
 *   is written back to the main Session.
 * - It is created through `ctx.agents.create` with `origin: 'subagent'` and
 *   `parentSession` set to the main Session, but WITHOUT a live
 *   `parentAgent` and without a `subagent/catalog` entry in the parent log:
 *   the left Session tree hides it, the main Session gets no catalog row and
 *   no completion notification, and the shipped prompt routes refuse it.
 * - It only talks to the browser through this plugin's Connection Fetch
 *   routes (create / prompt / cancel / close / list).
 * - It is read-only by construction: its tools are restricted to a
 *   read-only allow-list, a per-agent guard denies everything else, and a
 *   global guard keyed on the side-chat id prefix backs that up for any
 *   resume path this plugin does not own. The permission preset is pinned to
 *   `read-only` as defence in depth.
 */
import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
export type * from './shared.ts';
/** Cordis plugin name used by loader diagnostics. */
export declare const name = "side-chat";
/** Hard dependencies; presets, default model and permission presets are optional. */
export declare const inject: string[];
export interface Config {
    /** Agent preset mounted for side chats (falls back to the default preset when unknown). */
    agentPreset: string;
    /** Descriptor label recorded in each side-chat log. */
    label: string;
    /**
     * Hide non read-only tools from the side-chat model (default). When false
     * they stay visible, the read-only prompt section is left out, and every
     * call is refused by the guard instead. Only useful to exercise that guard.
     */
    hideUnavailableTools: boolean;
}
export declare const Config: Schema<Config>;
/**
 * Plugin body.
 * @param ctx - Host plugin context.
 * @param config - resolved configuration.
 */
export declare function apply(ctx: Context, config: Config): void;
