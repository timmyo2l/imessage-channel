import { describe, it, expect, beforeEach } from "bun:test"
import { PermissionManager } from "./permissions"

describe("PermissionManager.parseReply", () => {
  const pm = new PermissionManager(() => {}, 300_000)

  it("parses 'yes abcde'", () => {
    expect(pm.parseReply("yes abcde")).toEqual({ requestId: "abcde", behavior: "allow" })
  })

  it("parses 'no abcde'", () => {
    expect(pm.parseReply("no abcde")).toEqual({ requestId: "abcde", behavior: "deny" })
  })

  it("is case insensitive", () => {
    expect(pm.parseReply("YES ABCDE")).toEqual({ requestId: "abcde", behavior: "allow" })
  })

  it("handles leading/trailing whitespace", () => {
    expect(pm.parseReply("  yes abcde  ")).toEqual({ requestId: "abcde", behavior: "allow" })
  })

  it("rejects single-letter 'y'", () => {
    expect(pm.parseReply("y abcde")).toBeNull()
  })

  it("rejects single-letter 'n'", () => {
    expect(pm.parseReply("n abcde")).toBeNull()
  })

  it("rejects wrong ID length", () => {
    expect(pm.parseReply("yes abc")).toBeNull()
  })

  it("rejects ID containing 'l'", () => {
    expect(pm.parseReply("yes abcll")).toBeNull()
  })

  it("returns null for plain text", () => {
    expect(pm.parseReply("run the tests")).toBeNull()
  })

  it("returns null for bare 'yes' when no pending request", () => {
    const fresh = new PermissionManager(() => {}, 300_000)
    expect(fresh.parseReply("yes")).toBeNull()
  })

  it("returns null for bare 'no' when no pending request", () => {
    const fresh = new PermissionManager(() => {}, 300_000)
    expect(fresh.parseReply("no")).toBeNull()
  })
})

describe("PermissionManager bare yes/no", () => {
  it("bare 'yes' targets the most recent pending request", async () => {
    const pm = new PermissionManager(() => {}, 300_000)
    const promise = pm.store("abcde", 5000)
    const parsed = pm.parseReply("yes")
    expect(parsed).toEqual({ requestId: "abcde", behavior: "allow" })
    pm.respond(parsed!.requestId, parsed!.behavior)
    expect(await promise).toBe("allow")
  })

  it("bare 'no' targets the most recent pending request", async () => {
    const pm = new PermissionManager(() => {}, 300_000)
    const promise = pm.store("abcde", 5000)
    const parsed = pm.parseReply("no")
    expect(parsed).toEqual({ requestId: "abcde", behavior: "deny" })
    pm.respond(parsed!.requestId, parsed!.behavior)
    expect(await promise).toBe("deny")
  })

  it("bare 'yes' is case insensitive", () => {
    const pm = new PermissionManager(() => {}, 300_000)
    pm.store("abcde", 5000)
    expect(pm.parseReply("YES")).toEqual({ requestId: "abcde", behavior: "allow" })
  })

  it("bare reply targets latest request when multiple are pending", () => {
    const pm = new PermissionManager(() => {}, 300_000)
    pm.store("aaaaa", 5000)
    pm.store("bbbbb", 5000)
    expect(pm.parseReply("yes")).toEqual({ requestId: "bbbbb", behavior: "allow" })
  })

  it("clears lastRequestId after respond, so bare yes/no no longer matches", () => {
    const pm = new PermissionManager(() => {}, 300_000)
    pm.store("abcde", 5000)
    pm.respond("abcde", "allow")
    expect(pm.parseReply("yes")).toBeNull()
  })
})

describe("PermissionManager request lifecycle", () => {
  it("resolves with 'allow' when reply matches", async () => {
    const pm = new PermissionManager(() => {}, 300_000)
    const promise = pm.store("abcde", 5000)
    pm.respond("abcde", "allow")
    expect(await promise).toBe("allow")
  })

  it("resolves with 'deny' after timeout", async () => {
    const pm = new PermissionManager(() => {}, 50) // 50ms timeout
    const promise = pm.store("xyzwv", 50)
    expect(await promise).toBe("deny")
  })

  it("returns false when responding to unknown request_id", () => {
    const pm = new PermissionManager(() => {}, 300_000)
    expect(pm.respond("zzzzz", "allow")).toBe(false)
  })

  it("returns true when responding to known request_id", () => {
    const pm = new PermissionManager(() => {}, 300_000)
    pm.store("abcde", 5000)
    expect(pm.respond("abcde", "deny")).toBe(true)
  })

  it("calls onTimeout callback when request expires", async () => {
    const timedOut: string[] = []
    const pm = new PermissionManager((id) => timedOut.push(id), 50)
    await pm.store("abcde", 50)
    expect(timedOut).toEqual(["abcde"])
  })
})
