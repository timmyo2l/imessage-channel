import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { z } from "zod"
import { Database } from "bun:sqlite"
import { homedir } from "os"
import { join } from "path"
import { getInitialRowId, readNewMessages, sendMessage } from "./imessage"
import { PermissionManager } from "./permissions"

// ── Config validation ────────────────────────────────────────────────────────

const handle = process.env.IMESSAGE_HANDLE
if (!handle) {
  console.error("Error: IMESSAGE_HANDLE is not set.")
  console.error("Set it to your iPhone number (e.g. +61412345678) or Apple ID email.")
  process.exit(1)
}

const PHONE_RE = /^\+\d{7,15}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
if (!PHONE_RE.test(handle) && !EMAIL_RE.test(handle)) {
  console.error(`Error: IMESSAGE_HANDLE "${handle}" is not a valid phone number or email.`)
  console.error("Examples: +61412345678 or you@icloud.com")
  process.exit(1)
}

const timeoutMs = parseInt(process.env.PERMISSION_TIMEOUT_SECONDS ?? "300", 10) * 1000
// handle is guaranteed non-null after the checks above
const safeHandle = handle as string

// ── Database ─────────────────────────────────────────────────────────────────

const dbPath = process.env.CHAT_DB_PATH ?? join(homedir(), "Library", "Messages", "chat.db")
let db: Database
try {
  db = new Database(dbPath, { readonly: true })
} catch (e) {
  console.error("Error: Cannot open ~/Library/Messages/chat.db.")
  console.error("Grant Full Disk Access to Terminal (or Bun) in System Settings > Privacy & Security.")
  process.exit(1)
}
const chatDb = db!

// ── MCP server ───────────────────────────────────────────────────────────────

const server = new Server(
  { name: "imessage-channel", version: "0.1.0" },
  {
    capabilities: {
      tools: {},
      experimental: {
        "claude/channel": {},
        "claude/channel/permission": {},
      },
    },
  }
)

// ── Permission manager ───────────────────────────────────────────────────────

const permissions = new PermissionManager(
  (requestId) => console.error(`[permissions] auto-denied ${requestId} (timeout)`),
  timeoutMs
)

// ── Tools ────────────────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "reply",
      description: "Send an iMessage to the user's iPhone.",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "The message text to send." },
        },
        required: ["text"],
      },
    },
  ],
}))

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  if (req.params.name !== "reply") {
    return { content: [{ type: "text", text: `Unknown tool: ${req.params.name}` }], isError: true }
  }
  const text = (req.params.arguments as { text: string }).text
  const result = await sendMessage(safeHandle, text)
  if (!result.ok) {
    return { content: [{ type: "text", text: `Failed to send iMessage: ${result.error}` }], isError: true }
  }
  return { content: [{ type: "text", text: "Sent." }] }
})

// ── Inbound notification handlers ────────────────────────────────────────────

const PermissionRequestSchema = z.object({
  method: z.literal("notifications/claude/channel/permission_request"),
  params: z.object({
    request_id: z.string(),
    tool_name: z.string(),
    description: z.string(),
    input_preview: z.string(),
  }),
})

server.setNotificationHandler(PermissionRequestSchema, async ({ params }) => {
  const { request_id, tool_name, description, input_preview } = params
  const prompt =
    `Claude wants to run ${tool_name}:\n${description}\n${input_preview}\n\n` +
    `Reply: yes ${request_id}  OR  no ${request_id}`

  await sendMessage(safeHandle, prompt)
  const behavior = await permissions.store(request_id)

  await server.notification({
    method: "notifications/claude/channel/permission",
    params: { request_id, behavior },
  })
})

// ── Poller ────────────────────────────────────────────────────────────────────

async function startPoller() {
  let lastRowId = getInitialRowId(chatDb, safeHandle)

  const poll = async () => {
    try {
      const messages = readNewMessages(chatDb, safeHandle, lastRowId)
      for (const msg of messages) {
        lastRowId = msg.rowid

        // Skip messages with null text (Tapbacks/reactions — not useful to Claude)
        if (msg.text === null) continue

        // Check if this is a permission reply first
        const parsed = permissions.parseReply(msg.text)
        if (parsed) {
          const found = permissions.respond(parsed.requestId, parsed.behavior)
          if (found) continue // consumed by permission flow
        }

        // Forward as a channel message
        await server.notification({
          method: "notifications/claude/channel",
          params: { content: msg.text, meta: { handle: msg.handle } },
        })
      }
    } catch (e) {
      console.error("[poller] poll error:", e)
    }
  }

  setInterval(poll, 2000)
  console.error(`[imessage-channel] polling for messages from ${safeHandle}`)
}

// ── Start ─────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport()
await server.connect(transport)
await startPoller()
