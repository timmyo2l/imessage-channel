const PERMISSION_REPLY_RE = /^\s*(yes|no)\s+([a-km-z]{5})\s*$/i
const BARE_REPLY_RE = /^\s*(yes|no)\s*$/i

export type Behavior = "allow" | "deny"

type Pending = {
  resolve: (b: Behavior) => void
  timer: ReturnType<typeof setTimeout>
}

export class PermissionManager {
  private pending = new Map<string, Pending>()
  private lastRequestId: string | null = null

  constructor(
    private readonly onTimeout: (requestId: string) => void,
    private readonly timeoutMs: number
  ) {}

  /** Returns a Promise that resolves with the user's decision. */
  store(requestId: string, timeoutMs = this.timeoutMs): Promise<Behavior> {
    this.lastRequestId = requestId
    return new Promise<Behavior>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(requestId)) {
          if (this.lastRequestId === requestId) this.lastRequestId = null
          this.onTimeout(requestId)
          resolve("deny")
        }
      }, timeoutMs)
      this.pending.set(requestId, { resolve, timer })
    })
  }

  /** Resolves a pending request. Returns true if found, false if unknown. */
  respond(requestId: string, behavior: Behavior): boolean {
    const pending = this.pending.get(requestId)
    if (!pending) return false
    clearTimeout(pending.timer)
    this.pending.delete(requestId)
    if (this.lastRequestId === requestId) this.lastRequestId = null
    pending.resolve(behavior)
    return true
  }

  /**
   * Parses a user reply. Returns { requestId, behavior } or null if not a permission reply.
   * A bare "yes" or "no" targets the most recently added pending request.
   */
  parseReply(text: string): { requestId: string; behavior: Behavior } | null {
    const withId = PERMISSION_REPLY_RE.exec(text)
    if (withId) {
      return {
        requestId: withId[2].toLowerCase(),
        behavior: withId[1].toLowerCase() === "yes" ? "allow" : "deny",
      }
    }
    const bare = BARE_REPLY_RE.exec(text)
    if (bare && this.lastRequestId !== null) {
      return {
        requestId: this.lastRequestId,
        behavior: bare[1].toLowerCase() === "yes" ? "allow" : "deny",
      }
    }
    return null
  }
}
