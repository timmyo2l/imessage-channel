import { describe, it, expect, spyOn } from "bun:test"
import { Database } from "bun:sqlite"
import { getInitialRowId, readNewMessages, splitMessage, sendMessage } from "./imessage"

function makeTestDb(): Database {
  const db = new Database(":memory:")
  db.run(`CREATE TABLE message (
    ROWID INTEGER PRIMARY KEY,
    text TEXT,
    handle_id INTEGER,
    is_from_me INTEGER
  )`)
  db.run(`CREATE TABLE handle (
    ROWID INTEGER PRIMARY KEY,
    id TEXT
  )`)
  return db
}

describe("getInitialRowId", () => {
  it("returns 0 when the table is empty", () => {
    const db = makeTestDb()
    expect(getInitialRowId(db, "+61400000000")).toBe(0)
    db.close()
  })

  it("returns the max ROWID of messages from the given handle", () => {
    const db = makeTestDb()
    db.run(`INSERT INTO handle (ROWID, id) VALUES (1, '+61400000000')`)
    db.run(`INSERT INTO message (ROWID, text, handle_id, is_from_me) VALUES (10, 'hi', 1, 0)`)
    db.run(`INSERT INTO message (ROWID, text, handle_id, is_from_me) VALUES (11, 'there', 1, 0)`)
    expect(getInitialRowId(db, "+61400000000")).toBe(11)
    db.close()
  })

  it("ignores messages from other handles", () => {
    const db = makeTestDb()
    db.run(`INSERT INTO handle (ROWID, id) VALUES (1, '+61400000000')`)
    db.run(`INSERT INTO handle (ROWID, id) VALUES (2, '+61411111111')`)
    db.run(`INSERT INTO message (ROWID, text, handle_id, is_from_me) VALUES (99, 'other', 2, 0)`)
    expect(getInitialRowId(db, "+61400000000")).toBe(0)
    db.close()
  })
})

describe("readNewMessages", () => {
  it("returns nothing when no messages are newer than lastRowId", () => {
    const db = makeTestDb()
    db.run(`INSERT INTO handle (ROWID, id) VALUES (1, '+61400000000')`)
    db.run(`INSERT INTO message (ROWID, text, handle_id, is_from_me) VALUES (5, 'old', 1, 0)`)
    const msgs = readNewMessages(db, "+61400000000", 5)
    expect(msgs).toHaveLength(0)
    db.close()
  })

  it("returns messages with ROWID greater than lastRowId", () => {
    const db = makeTestDb()
    db.run(`INSERT INTO handle (ROWID, id) VALUES (1, '+61400000000')`)
    db.run(`INSERT INTO message (ROWID, text, handle_id, is_from_me) VALUES (5, 'old', 1, 0)`)
    db.run(`INSERT INTO message (ROWID, text, handle_id, is_from_me) VALUES (6, 'new', 1, 0)`)
    const msgs = readNewMessages(db, "+61400000000", 5)
    expect(msgs).toHaveLength(1)
    expect(msgs[0]).toEqual({ rowid: 6, text: "new", handle: "+61400000000" })
    db.close()
  })

  it("ignores outbound messages (is_from_me = 1)", () => {
    const db = makeTestDb()
    db.run(`INSERT INTO handle (ROWID, id) VALUES (1, '+61400000000')`)
    db.run(`INSERT INTO message (ROWID, text, handle_id, is_from_me) VALUES (10, 'sent by me', 1, 1)`)
    const msgs = readNewMessages(db, "+61400000000", 0)
    expect(msgs).toHaveLength(0)
    db.close()
  })

  it("returns multiple messages in ROWID order", () => {
    const db = makeTestDb()
    db.run(`INSERT INTO handle (ROWID, id) VALUES (1, '+61400000000')`)
    db.run(`INSERT INTO message (ROWID, text, handle_id, is_from_me) VALUES (7, 'first', 1, 0)`)
    db.run(`INSERT INTO message (ROWID, text, handle_id, is_from_me) VALUES (8, 'second', 1, 0)`)
    const msgs = readNewMessages(db, "+61400000000", 6)
    expect(msgs.map(m => m.text)).toEqual(["first", "second"])
    db.close()
  })
})

describe("splitMessage", () => {
  it("returns the text as-is when under the limit", () => {
    expect(splitMessage("hello")).toEqual(["hello"])
  })

  it("splits on paragraph boundaries (double newline)", () => {
    const text = "para one\n\npara two\n\npara three"
    // maxLen=15: "para one\n\npara two" = 18 chars > 15, so paragraphs can't be combined
    expect(splitMessage(text, 15)).toEqual(["para one", "para two", "para three"])
  })

  it("hard-splits a paragraph that exceeds the limit", () => {
    const long = "a".repeat(3000)
    const parts = splitMessage(long, 1500)
    expect(parts).toHaveLength(2)
    expect(parts[0]).toHaveLength(1500)
    expect(parts[1]).toHaveLength(1500)
  })

  it("combines short paragraphs into chunks under the limit", () => {
    // Two short paras that together fit in one chunk
    const text = "short one\n\nshort two"
    const parts = splitMessage(text, 1500)
    expect(parts).toHaveLength(1)
    expect(parts[0]).toBe("short one\n\nshort two")
  })

  it("keeps oversized paragraph alongside short ones correctly", () => {
    const big = "x".repeat(1600)
    const text = `tiny\n\n${big}\n\nsmall`
    const parts = splitMessage(text, 1500)
    // "tiny" is small, big splits into 2, "small" is its own
    expect(parts.length).toBeGreaterThanOrEqual(3)
    expect(parts[0]).toBe("tiny")
  })
})

describe("sendMessage", () => {
  it("calls Bun.spawnSync with osascript and returns ok:true on success", async () => {
    const spy = spyOn(Bun, "spawnSync").mockReturnValue({
      exitCode: 0,
      stdout: Buffer.from(""),
      stderr: Buffer.from(""),
    } as any)

    const result = await sendMessage("+61400000000", "hello")
    expect(result).toEqual({ ok: true })
    expect(spy).toHaveBeenCalled()
    const args = spy.mock.calls[0][0] as string[]
    expect(args[0]).toBe("osascript")
    expect(args[1]).toBe("-e")
    expect(args[2]).toContain('tell application "Messages"')
    expect(args[2]).toContain("hello")  // the message text appears in the script
    spy.mockRestore()
  })

  it("returns ok:false with stderr when osascript exits non-zero", async () => {
    const spy = spyOn(Bun, "spawnSync").mockReturnValue({
      exitCode: 1,
      stdout: Buffer.from(""),
      stderr: Buffer.from("Messages not running"),
    } as any)

    const result = await sendMessage("+61400000000", "hello")
    expect(result).toEqual({ ok: false, error: "Messages not running" })
    spy.mockRestore()
  })
})
