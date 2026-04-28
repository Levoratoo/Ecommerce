import { Router } from "express"
import { authMiddleware } from "../middleware/auth"
import { tenantMiddleware } from "../middleware/tenant"
import { db } from "../db/index"

const router = Router()
router.use(authMiddleware, tenantMiddleware)

// GET /api/v1/conversations
router.get("/", async (req, res) => {
  const orgId = req.organizationId!
  const page = Math.max(1, parseInt(req.query.page as string) || 1)
  const limit = Math.min(50, parseInt(req.query.limit as string) || 20)
  const offset = (page - 1) * limit

  try {
    const rows = await db`
      SELECT
        c.id,
        c.last_message_at,
        c.unread_count,
        c.created_at,
        ct.id           AS contact_id,
        ct.name         AS contact_name,
        ct.phone_number AS contact_phone
      FROM conversations c
      JOIN contacts ct ON ct.id = c.contact_id
      WHERE c.organization_id = ${orgId}
      ORDER BY c.last_message_at DESC NULLS LAST
      LIMIT ${limit} OFFSET ${offset}
    `

    res.json(
      rows.map((r) => ({
        id: r.id,
        lastMessageAt: r.last_message_at,
        unreadCount: r.unread_count,
        createdAt: r.created_at,
        contact: {
          id: r.contact_id,
          name: r.contact_name,
          phoneNumber: r.contact_phone,
        },
      }))
    )
  } catch (err) {
    console.error("[conversations] GET /", err)
    res.status(500).json({ error: "Erro interno" })
  }
})

// GET /api/v1/conversations/:id
router.get("/:id", async (req, res) => {
  const orgId = req.organizationId!
  const { id } = req.params

  try {
    const [conv] = await db`
      SELECT
        c.id,
        c.whatsapp_chat_id,
        c.last_message_at,
        c.unread_count,
        c.created_at,
        ct.id           AS contact_id,
        ct.name         AS contact_name,
        ct.phone_number AS contact_phone
      FROM conversations c
      JOIN contacts ct ON ct.id = c.contact_id
      WHERE c.id = ${id} AND c.organization_id = ${orgId}
    `

    if (!conv) return res.status(404).json({ error: "Conversa não encontrada" })

    // Retorna as 50 mensagens mais recentes em ordem cronológica (mais antiga primeiro)
    const messages = await db`
      SELECT * FROM (
        SELECT id, direction, content, status, sent_at, whatsapp_message_id
        FROM messages
        WHERE conversation_id = ${id} AND organization_id = ${orgId}
        ORDER BY sent_at DESC
        LIMIT 50
      ) sub
      ORDER BY sent_at ASC
    `

    res.json({
      id: conv.id,
      whatsappChatId: conv.whatsapp_chat_id,
      lastMessageAt: conv.last_message_at,
      unreadCount: conv.unread_count,
      createdAt: conv.created_at,
      contact: {
        id: conv.contact_id,
        name: conv.contact_name,
        phoneNumber: conv.contact_phone,
      },
      messages: messages.map((m) => ({
        id: m.id,
        direction: m.direction,
        content: m.content,
        status: m.status,
        sentAt: m.sent_at,
        whatsappMessageId: m.whatsapp_message_id,
      })),
    })
  } catch (err) {
    console.error("[conversations] GET /:id", err)
    res.status(500).json({ error: "Erro interno" })
  }
})

// POST /api/v1/conversations/:id/read
router.post("/:id/read", async (req, res) => {
  const orgId = req.organizationId!
  const { id } = req.params

  try {
    const [updated] = await db`
      UPDATE conversations
      SET unread_count = 0
      WHERE id = ${id} AND organization_id = ${orgId}
      RETURNING id
    `

    if (!updated) return res.status(404).json({ error: "Conversa não encontrada" })

    res.status(204).send()
  } catch (err) {
    console.error("[conversations] POST /:id/read", err)
    res.status(500).json({ error: "Erro interno" })
  }
})

export default router
