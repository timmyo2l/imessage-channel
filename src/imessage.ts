import { Database } from "bun:sqlite"

export type Message = {
  rowid: number
  text: string
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
  WHERE m.ROWID > ? AND h.id = ? AND m.is_from_me = 0
  ORDER BY m.ROWID ASC
`

export function getInitialRowId(db: Database, handle: string): number {
  const row = db.query(QUERY_INITIAL).get(handle) as { maxRowId: number } | null
  return row?.maxRowId ?? 0
}

export function readNewMessages(db: Database, handle: string, afterRowId: number): Message[] {
  return db.query(QUERY_NEW).all(afterRowId, handle) as Message[]
}
