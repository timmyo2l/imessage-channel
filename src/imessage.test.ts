import { describe, it, expect } from "bun:test"
import { Database } from "bun:sqlite"
import { getInitialRowId, readNewMessages } from "./imessage"

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
