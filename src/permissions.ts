const PERMISSION_REPLY_RE = /^\s*(yes|no)\s+([a-km-z]{5})\s*$/i

export type Behavior = "allow" | "deny"

type Pending = {
  resolve: (b: Behavior) => void
  timer: ReturnType<typeof setTimeout>
}

export class PermissionManager {
  private pending = new Map<string, Pending>()

  constructor(
    private readonly onTimeout: (requestId: string) => void,
    private readonly timeoutMs: number
  ) {}

  /** Returns a Promise that resolves with the user's decision. */
  store(requestId: string, timeoutMs = this.timeoutMs): Promise<Behavior> {
    return new Promise<Behavior>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(requestId)) {
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
    pending.resolve(behavior)
    return true
  }

  /** Parses a user reply. Returns { requestId, behavior } or null if not a permission reply. */
  parseReply(text: string): { requestId: string; behavior: Behavior } | null {
    const m = PERMISSION_REPLY_RE.exec(text)
    if (!m) return null
    return {
      requestId: m[2].toLowerCase(),
      behavior: m[1].toLowerCase() === "yes" ? "allow" : "deny",
    }
  }
}
