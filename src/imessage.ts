import { Database, Statement } from "bun:sqlite"

export type Message = {
  rowid: number
  text: string | null
  handle: string
}

export type SendResult = { ok: true } | { ok: false; error: string }

const QUERY_INITIAL = `
  SELECT COALESCE(MAX(m.ROWID), 0) AS maxRowId
  FROM message m
  JOIN handle h ON m.handle_id = h.ROWID
  WHERE h.id = ? AND m.is_from_me = 0
`

const QUERY_NEW = `
  SELECT m.ROWID AS rowid, m.text, h.id AS handle
  FROM message m
  JOIN handle h ON m.handle_id = h.ROWID
  WHERE m.ROWID > ? AND h.id = ? AND m.is_from_me = 0 AND m.text IS NOT NULL
  ORDER BY m.ROWID ASC
`

type Stmts = { initial: Statement; newMsgs: Statement }
const stmtCache = new WeakMap<Database, Stmts>()

function getStmts(db: Database): Stmts {
  if (!stmtCache.has(db)) {
    stmtCache.set(db, {
      initial: db.prepare(QUERY_INITIAL),
      newMsgs: db.prepare(QUERY_NEW),
    })
  }
  return stmtCache.get(db)!
}

export function getInitialRowId(db: Database, handle: string): number {
  const row = getStmts(db).initial.get(handle) as { maxRowId: number } | null
  return row?.maxRowId ?? 0
}

export function readNewMessages(db: Database, handle: string, afterRowId: number): Message[] {
  return getStmts(db).newMsgs.all(afterRowId, handle) as Message[]
}
