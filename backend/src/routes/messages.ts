import { Router } from "express"
import { authMiddleware } from "../middleware/auth"
import { tenantMiddleware } from "../middleware/tenant"
import { db } from "../db/index"
import { sendText } from "../services/evolutionApi"
import { emit } from "../services/sseManager"

const router = Router()
router.use(authMiddleware, tenantMiddleware)

// POST /api/v1/messages
router.post("/", async (req, res) => {
  const orgId = req.organizationId!
  const { conversation_id, content } = req.body

  if (!conversation_id || !content) {
    return res.status(400).json({ error: "conversation_id e content são obrigatórios" })
  }

  try {
    // Verifica que a conversa pertence ao tenant e pega o whatsapp_chat_id
    const [conv] = await db`
      SELECT whatsapp_chat_id
      FROM conversations
      WHERE id = ${conversation_id} AND organization_id = ${orgId}
    `

    if (!conv) return res.status(404).json({ error: "Conversa não encontrada" })

    // Busca a instância Evolution API do tenant
    const [instance] = await db`
      SELECT instance_name, api_url, api_key
      FROM evolution_instances
      WHERE organization_id = ${orgId}
    `

    if (!instance) {
      return res.status(503).json({ error: "WhatsApp não configurado para esta organização" })
    }

    // whatsapp_chat_id tem formato 5585999887766@s.whatsapp.net
    const number = (conv.whatsapp_chat_id as string).replace(/@.*$/, "")

    await sendText(
      instance.api_url as string,
      instance.instance_name as string,
      instance.api_key as string,
      number,
      content
    )

    const [message] = await db`
      INSERT INTO messages (organization_id, conversation_id, direction, content, status)
      VALUES (${orgId}, ${conversation_id}, 'out', ${content}, 'sent')
      RETURNING id, direction, content, status, sent_at
    `

    await db`
      UPDATE conversations
      SET last_message_at = NOW()
      WHERE id = ${conversation_id}
    `

    const payload = {
      id: message.id,
      conversationId: conversation_id,
      direction: message.direction,
      content: message.content,
      status: message.status,
      sentAt: message.sent_at,
      whatsappMessageId: null,
    }

    emit(orgId, "new_message", { conversation_id, message: payload })

    res.status(201).json(payload)
  } catch (err) {
    console.error("[messages] POST /", err)
    res.status(500).json({ error: "Erro interno" })
  }
})

export default router
