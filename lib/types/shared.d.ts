/**
 * Wire contract shared by the Host and browser faces of dsh-plugin-side-chat.
 *
 * Every route is an exact Connection Fetch route, so it inherits the
 * Connection's trust and authentication fence (owner Peers only).
 */
/** `POST { parentSessionId }` → {@link SideChatCreated}. */
export declare const CREATE_PATH = "/api/side-chat.create";
/** `POST { sessionId, parentSessionId, text, requestId }` → {@link SideChatAccepted}. */
export declare const PROMPT_PATH = "/api/side-chat.prompt";
/** `POST { sessionId }` → {@link SideChatAccepted}: interrupt the running turn. */
export declare const CANCEL_PATH = "/api/side-chat.cancel";
/** `POST { sessionId }` → {@link SideChatAccepted}: stop the live agent (history is kept). */
export declare const CLOSE_PATH = "/api/side-chat.close";
/** `GET ?parentSessionId=<id>` → {@link SideChatList}: side chats live in this Host process. */
export declare const LIST_PATH = "/api/side-chat.list";
/**
 * Every side-chat Session id starts with this prefix. The Host guard keys on
 * it, so the read-only policy survives restarts and any foreign resume path.
 */
export declare const SIDE_CHAT_ID_PREFIX = "session-sidechat-";
/** The `subagent/descriptor` provider name stamped into each side-chat log. */
export declare const SIDE_CHAT_PROVIDER = "side-chat";
/**
 * The only tools a side chat may execute. Everything else (shell, edit/write,
 * PTC `run_code`, subagents, messaging, MCP tools, …) is denied by guard.
 */
export declare const READ_ONLY_TOOLS: readonly string[];
/** Upper bound on one prompt's text, in UTF-16 code units. */
export declare const MAX_PROMPT_LENGTH = 100000;
/**
 * Whether a Session id names a side chat.
 * @param sessionId - candidate Session id.
 * @returns true for ids minted by this plugin.
 */
export declare function isSideChatId(sessionId: string | undefined | null): boolean;
export interface SideChatCreated {
    sessionId: string;
    parentSessionId: string;
    /** Number of main-session events inherited by the seed (0 = empty side chat). */
    inheritedEvents: number;
}
export interface SideChatAccepted {
    accepted: boolean;
}
export interface SideChatSummary {
    sessionId: string;
    parentSessionId: string;
    createdAt: number;
}
export interface SideChatList {
    sessions: SideChatSummary[];
}
/** Error body of every non-2xx answer. */
export interface SideChatError {
    error: string;
    code?: string;
}
