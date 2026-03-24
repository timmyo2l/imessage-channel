import { Database, Statement } from "bun:sqlite"

export type Message = {
  rowid: number
  text: string   // non-null: SQL query filters AND m.text IS NOT NULL
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

const MAX_LEN = 1500

// Hard-split a string at maxLen boundaries
function hardSplit(text: string, maxLen: number): string[] {
  const parts: string[] = []
  for (let i = 0; i < text.length; i += maxLen) {
    parts.push(text.slice(i, i + maxLen))
  }
  return parts
}

export function splitMessage(text: string, maxLen = MAX_LEN): string[] {
  const paragraphs = text.split(/\n\n/)
  const result: string[] = []
  let current = ""

  for (const para of paragraphs) {
    // Para itself exceeds limit — hard split it
    if (para.length > maxLen) {
      if (current) { result.push(current); current = "" }
      result.push(...hardSplit(para, maxLen))
      continue
    }
    // Would adding para overflow current chunk?
    const candidate = current ? current + "\n\n" + para : para
    if (candidate.length > maxLen) {
      result.push(current)
      current = para
    } else {
      current = candidate
    }
  }
  if (current) result.push(current)
  return result
}

function buildAppleScript(handle: string, text: string): string {
  const escapeForAppleScript = (s: string) =>
    s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")
  return `tell application "Messages"\nsend "${escapeForAppleScript(text)}" to buddy "${escapeForAppleScript(handle)}" of service "iMessage"\nend tell`
}

export async function sendMessage(handle: string, text: string): Promise<SendResult> {
  const parts = splitMessage(text)
  for (const part of parts) {
    const script = buildAppleScript(handle, part)
    const result = Bun.spawnSync(["osascript", "-e", script])
    if (result.exitCode !== 0) {
      return { ok: false, error: result.stderr.toString().trim() }
    }
  }
  return { ok: true }
}
