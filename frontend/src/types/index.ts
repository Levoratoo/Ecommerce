export interface User {
  id: string
  name: string | null
  email: string
  role: 'owner' | 'member'
  organizationId: string
}

export interface Contact {
  id: string
  organizationId: string
  phoneNumber: string
  name: string | null
  company: string | null
  notes: string | null
  tags: string[]
  createdAt: string
  updatedAt: string
}

export interface Message {
  id: string
  conversationId: string
  direction: 'in' | 'out'
  content: string
  status: 'sent' | 'delivered' | 'read' | 'failed'
  sentAt: string
  whatsappMessageId: string | null
}

export interface Conversation {
  id: string
  organizationId: string
  contactId: string
  whatsappChatId: string
  lastMessageAt: string | null
  unreadCount: number
  createdAt: string
  contact: Pick<Contact, 'id' | 'name' | 'phoneNumber'>
}

export interface PipelineStage {
  id: string
  name: string
  position: number
  cards: PipelineCard[]
}

export interface PipelineCard {
  id: string
  contactId: string
  stageId: string
  position: number
  contact: Pick<Contact, 'id' | 'name' | 'phoneNumber'>
}
