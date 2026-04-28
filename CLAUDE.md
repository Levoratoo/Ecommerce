# CLAUDE.md — WhatsApp CRM SaaS

## Regras de Operação do Claude Code

- **Nunca** implemente nada sem antes apresentar um plano de execução e aguardar aprovação
- **Nunca** faça commit ou push sem confirmação explícita do desenvolvedor
- Sempre explique decisões arquiteturais antes de implementar
- Ao encontrar ambiguidade, pergunte — não assuma
- Segurança e isolamento multi-tenant são não-negociáveis: qualquer query que acesse dados sem filtrar por `organization_id` é um bug crítico

---

## 1. Visão Geral do Projeto

CRM web integrado ao WhatsApp, distribuído como SaaS multi-tenant. Permite que profissionais autônomos e pequenas empresas gerenciem conversas de WhatsApp, contatos e pipeline de vendas em um único painel.

**Objetivo do MVP:** entregar as três funcionalidades core para a primeira cliente (usuária solo, MEI) com arquitetura já preparada para múltiplos tenants.

**Estratégia de produto:**
- Primeira cliente: usuária única, organização única — usada para validar o produto
- Arquitetura multi-tenant desde o dia 1: isolamento por `organization_id` em todas as tabelas
- Novas organizações criadas manualmente via script/SQL no MVP — painel de super admin é fase futura
- Monetização e onboarding self-service são pós-MVP

**Módulos do MVP:**
1. **Autenticação** — login com email e senha, JWT via Auth.js, 1 usuário por organização
2. **Caixa de entrada WhatsApp** — conversas em tempo real, indicador de não lidas, envio e recebimento via Evolution API
3. **Clientes** — cadastro, edição, vinculação com conversas, abas por cliente (estado via Zustand)
4. **Empresa contratante** — dados da empresa, lista de contatos internos
5. **Lembretes** — título, descrição, data/hora, vínculo com cliente ou empresa, notificação visual via polling

**Pipeline Kanban foi removido do escopo.**

---

## 2. Arquitetura Técnica

### Stack

| Camada | Tecnologia | Hospedagem |
|---|---|---|
| Frontend | React + Vite + TypeScript | Vercel |
| Backend | Node.js + Express | Railway |
| Banco de dados | PostgreSQL serverless | Neon |
| Autenticação | Auth.js (NextAuth adaptado para Express) | — |
| WhatsApp | Evolution API (self-hosted) | Railway |
| Tempo real | SSE (Server-Sent Events) | Via backend Express |

### Diagrama de Componentes

```
┌─────────────────────────────────────────────────────────────────┐
│                        USUÁRIO (Browser)                        │
│                     React + Vite (Vercel)                       │
└────────────────────────┬───────────────────────────────────────┘
                         │ HTTP / SSE
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Backend Express (Railway)                      │
│                                                                 │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │  Auth.js    │  │  REST API    │  │  SSE Endpoint         │  │
│  │  /api/auth  │  │  /api/v1/... │  │  /api/events          │  │
│  └─────────────┘  └──────┬───────┘  └───────────┬───────────┘  │
│                          │                       │               │
│  ┌───────────────────────▼───────────────────────▼───────────┐  │
│  │              Middleware de Tenant                          │  │
│  │  Extrai organization_id do JWT → injeta em todas as       │  │
│  │  queries como filtro obrigatório                          │  │
│  └───────────────────────────────────────────────────────────┘  │
│                          │                                       │
│  ┌───────────────────────▼───────────────────────────────────┐  │
│  │              Neon PostgreSQL (via pg/postgres.js)          │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  /webhooks/evolution  ← Evolution API POST               │   │
│  │  Recebe mensagens → salva no banco → emite SSE            │   │
│  └──────────────────────────────────────────────────────────┘   │
└────────────────────────────────────┬────────────────────────────┘
                                     │ HTTP REST
                                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Evolution API (Railway)                        │
│              Self-hosted, uma instância por tenant               │
│         Conectada ao WhatsApp via QR Code / pairing code         │
└─────────────────────────────────────────────────────────────────┘
```

### Fluxo de Mensagem Recebida

```
WhatsApp → Evolution API → POST /webhooks/evolution
  → valida EVOLUTION_WEBHOOK_SECRET
  → identifica tenant via instanceName
  → upsert contato (se novo)
  → salva mensagem no banco
  → emite evento SSE para todos os clientes SSE desse organization_id
  → frontend React atualiza conversa em tempo real
```

### Fluxo de Mensagem Enviada

```
Usuário clica "Enviar" → POST /api/v1/messages
  → middleware valida JWT + extrai organization_id
  → busca credenciais da Evolution API do tenant
  → POST para Evolution API /message/sendText/{instanceName}
  → salva mensagem no banco (direção: "out")
  → retorna confirmação para o frontend
```

---

## 3. Banco de Dados

**Banco:** Neon PostgreSQL serverless  
**Regra absoluta:** toda tabela de dados de negócio tem `organization_id` como coluna obrigatória e indexada. Nenhuma query retorna dados sem filtrar por `organization_id`.

### Schema Completo

```sql
-- =============================================
-- ORGANIZATIONS (tenants)
-- =============================================
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,       -- usado em URLs e logs
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- USERS
-- =============================================
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255),
  role VARCHAR(50) DEFAULT 'member',       -- 'owner' | 'member'
  password_hash VARCHAR(255),              -- gerenciado pelo Auth.js
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_organization ON users(organization_id);

-- =============================================
-- EVOLUTION API INSTANCES (uma por organização)
-- =============================================
CREATE TABLE evolution_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  instance_name VARCHAR(255) NOT NULL UNIQUE,  -- usado como chave na Evolution API
  api_url VARCHAR(500) NOT NULL,               -- URL base da Evolution API desse tenant
  api_key VARCHAR(500) NOT NULL,               -- chave de acesso à instância
  phone_number VARCHAR(50),                    -- número conectado (preenchido após conexão)
  status VARCHAR(50) DEFAULT 'disconnected',   -- 'connected' | 'disconnected' | 'qr_pending'
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_evolution_organization ON evolution_instances(organization_id);

-- =============================================
-- CONTACTS
-- =============================================
CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  phone_number VARCHAR(50) NOT NULL,
  name VARCHAR(255),
  company VARCHAR(255),
  notes TEXT,
  tags TEXT[],                                 -- array de strings
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id, phone_number)         -- mesmo número não duplica dentro do tenant
);

CREATE INDEX idx_contacts_organization ON contacts(organization_id);
CREATE INDEX idx_contacts_phone ON contacts(organization_id, phone_number);

-- =============================================
-- CONVERSATIONS
-- =============================================
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  whatsapp_chat_id VARCHAR(255) NOT NULL,      -- ID interno do WhatsApp (ex: 5585999887766@s.whatsapp.net)
  last_message_at TIMESTAMPTZ,
  unread_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id, whatsapp_chat_id)
);

CREATE INDEX idx_conversations_organization ON conversations(organization_id);
CREATE INDEX idx_conversations_contact ON conversations(contact_id);
CREATE INDEX idx_conversations_last_message ON conversations(organization_id, last_message_at DESC);

-- =============================================
-- MESSAGES
-- =============================================
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  whatsapp_message_id VARCHAR(255),            -- ID da mensagem no WhatsApp (para deduplicação)
  direction VARCHAR(10) NOT NULL,              -- 'in' | 'out'
  content TEXT NOT NULL,
  status VARCHAR(50) DEFAULT 'sent',           -- 'sent' | 'delivered' | 'read' | 'failed'
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id, whatsapp_message_id) -- evita duplicatas de webhook
);

CREATE INDEX idx_messages_conversation ON messages(conversation_id, sent_at);
CREATE INDEX idx_messages_organization ON messages(organization_id);

-- =============================================
-- PIPELINE
-- =============================================
CREATE TABLE pipeline_stages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  position INT NOT NULL,                       -- ordem das colunas no Kanban
  is_default BOOLEAN DEFAULT FALSE             -- se é uma coluna padrão do sistema
);

-- Colunas padrão (inseridas via seed por organização):
-- Novo lead (0), Em contato (1), Proposta enviada (2), Fechado (3), Perdido (4)

CREATE TABLE pipeline_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  stage_id UUID NOT NULL REFERENCES pipeline_stages(id),
  position INT NOT NULL,                       -- posição dentro da coluna
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_pipeline_cards_organization ON pipeline_cards(organization_id);
CREATE INDEX idx_pipeline_cards_stage ON pipeline_cards(stage_id);
```

---

## 4. API Backend — Endpoints

**Base URL:** `https://[backend-railway-url]/api/v1`  
**Auth:** todas as rotas (exceto `/auth` e `/webhooks`) exigem `Authorization: Bearer <jwt>` no header.  
**Middleware de tenant:** extrai `organization_id` do JWT e injeta em `req.organizationId` — presente em todas as rotas protegidas.

### Autenticação (`/api/auth`)

Gerenciado pelo Auth.js — rotas padrão da lib.

```
POST /api/auth/signin          — login com email/senha
POST /api/auth/signout         — logout
GET  /api/auth/session         — sessão atual
```

JWT payload mínimo:
```json
{
  "userId": "uuid",
  "organizationId": "uuid",
  "role": "owner | member"
}
```

---

### Conversas

```
GET  /api/v1/conversations
  → lista todas as conversas do tenant, ordenadas por last_message_at DESC
  → inclui: id, contact.name, contact.phone_number, last_message_at, unread_count
  → query params: ?page=1&limit=20

GET  /api/v1/conversations/:id
  → detalhes da conversa + últimas 50 mensagens
  → query params: ?before=<message_id> (paginação)

POST /api/v1/conversations/:id/read
  → zera unread_count da conversa
  → body: {}
```

---

### Mensagens

```
POST /api/v1/messages
  → envia mensagem de texto via Evolution API
  → body: { conversation_id: string, content: string }
  → salva no banco com direction: 'out'
  → retorna a mensagem salva
```

---

### Contatos

```
GET  /api/v1/contacts
  → lista contatos do tenant
  → query params: ?search=nome&page=1&limit=20

GET  /api/v1/contacts/:id
  → detalhes do contato + última conversa + histórico de mensagens

POST /api/v1/contacts
  → cadastro manual de contato
  → body: { phone_number, name?, company?, notes?, tags? }

PATCH /api/v1/contacts/:id
  → edição parcial
  → body: { name?, company?, notes?, tags? }

DELETE /api/v1/contacts/:id
  → soft delete ou remoção (definir antes de implementar)
```

---

### Pipeline

```
GET  /api/v1/pipeline
  → retorna todas as colunas com seus cards
  → resposta: { stages: [{ id, name, position, cards: [...] }] }
  → cada card inclui: id, contact.name, contact.phone_number, last_message preview

PATCH /api/v1/pipeline/cards/:id/move
  → move card para outra coluna ou muda posição
  → body: { stage_id: string, position: number }
```

---

### Evolution API — Gerenciamento de Instância

```
GET  /api/v1/whatsapp/status
  → retorna status da instância do tenant (connected | disconnected | qr_pending)

POST /api/v1/whatsapp/connect
  → solicita QR code para conexão
  → retorna: { qr_code: "base64..." }

POST /api/v1/whatsapp/disconnect
  → desconecta a instância
```

---

### Webhook (sem autenticação JWT — validado por secret)

```
POST /webhooks/evolution
  → recebido da Evolution API quando chega uma mensagem
  → header: X-Evolution-Secret: <EVOLUTION_WEBHOOK_SECRET>
  → body: payload padrão da Evolution API (ver seção 5)
  → não requer JWT — usa o instanceName para identificar o tenant
```

---

## 5. Integração com a Evolution API

### Modelo Multi-Tenant

Cada organização tem **uma instância própria** na Evolution API, identificada por um `instance_name` único (ex: `org_slug_whatsapp`).

A Evolution API roda como serviço único no Railway, mas gerencia múltiplas instâncias. As credenciais por instância ficam na tabela `evolution_instances`.

### Configuração de uma Nova Instância (por tenant)

1. Chamar `POST {EVOLUTION_API_URL}/instance/create` com `{ "instanceName": "org_slug_whatsapp" }`
2. Configurar webhook: `POST {EVOLUTION_API_URL}/webhook/set/{instanceName}` com:
   ```json
   {
     "url": "https://[backend-railway-url]/webhooks/evolution",
     "webhook_by_events": false,
     "events": ["MESSAGES_UPSERT"]
   }
   ```
3. Iniciar conexão via QR Code: `GET {EVOLUTION_API_URL}/instance/connect/{instanceName}`
4. Salvar `api_key` e `instance_name` na tabela `evolution_instances`

### Payload do Webhook (mensagem recebida)

```json
{
  "event": "messages.upsert",
  "instance": "org_slug_whatsapp",
  "data": {
    "key": {
      "remoteJid": "5585999887766@s.whatsapp.net",
      "fromMe": false,
      "id": "WHATSAPP_MESSAGE_ID"
    },
    "message": {
      "conversation": "texto da mensagem"
    },
    "messageTimestamp": 1700000000,
    "pushName": "Nome do Contato"
  }
}
```

**Processamento no backend:**

```
1. Validar X-Evolution-Secret
2. Extrair instance_name do campo "instance"
3. Buscar organization_id via evolution_instances WHERE instance_name = ?
4. Extrair phone_number de remoteJid (remover @s.whatsapp.net)
5. UPSERT em clients (organization_id + whatsapp)
6. UPSERT em conversations (organization_id + whatsapp_chat_id, client_id)
7. INSERT em messages (verificar UNIQUE em whatsapp_message_id para evitar duplicata)
8. Atualizar conversations.last_message_at e unread_count
9. Emitir evento SSE para clientes conectados desse organization_id
```

### Envio de Mensagem

```
POST {EVOLUTION_API_URL}/message/sendText/{instanceName}
Headers: { apikey: <instance_api_key> }
Body: {
  "number": "5585999887766",
  "text": "texto da mensagem"
}
```

### SSE — Eventos em Tempo Real

O endpoint `GET /api/events` mantém uma conexão SSE aberta por cliente.  
O servidor emite eventos filtrados por `organization_id` extraído do JWT.

Eventos emitidos:
```
event: new_message
data: { conversation_id, message: { id, content, direction, sent_at } }

event: conversation_updated
data: { conversation_id, unread_count, last_message_at }
```

---

## 6. Estrutura de Pastas

```
/
├── frontend/                          # React + Vite (deploy: Vercel)
│   ├── src/
│   │   ├── components/
│   │   │   ├── inbox/                 # Caixa de entrada
│   │   │   │   ├── ConversationList.tsx
│   │   │   │   └── MessageThread.tsx
│   │   │   ├── contacts/              # Módulo de contatos
│   │   │   │   ├── ContactTabs.tsx    # Sistema de abas
│   │   │   │   └── ContactPanel.tsx
│   │   │   ├── pipeline/              # Kanban
│   │   │   │   ├── PipelineBoard.tsx
│   │   │   │   └── PipelineCard.tsx
│   │   │   └── ui/                    # Componentes reutilizáveis
│   │   ├── hooks/
│   │   │   ├── useSSE.ts              # Conexão SSE
│   │   │   ├── useConversations.ts
│   │   │   └── useContacts.ts
│   │   ├── lib/
│   │   │   ├── api.ts                 # Funções de fetch para o backend
│   │   │   └── auth.ts                # Auth.js client config
│   │   ├── pages/
│   │   │   ├── InboxPage.tsx
│   │   │   ├── ContactsPage.tsx
│   │   │   └── PipelinePage.tsx
│   │   ├── store/                     # Estado global (Zustand ou Context)
│   │   └── types/                     # TypeScript interfaces
│   ├── .env.local                     # variáveis de ambiente (não comitar)
│   ├── vite.config.ts
│   └── package.json
│
├── backend/                           # Node.js + Express (deploy: Railway)
│   ├── src/
│   │   ├── routes/
│   │   │   ├── auth.ts                # Auth.js adapter
│   │   │   ├── conversations.ts
│   │   │   ├── contacts.ts
│   │   │   ├── messages.ts
│   │   │   ├── pipeline.ts
│   │   │   ├── whatsapp.ts            # Gerenciamento de instância
│   │   │   ├── webhooks.ts            # /webhooks/evolution
│   │   │   └── events.ts              # SSE endpoint
│   │   ├── middleware/
│   │   │   ├── auth.ts                # Valida JWT, injeta req.userId
│   │   │   └── tenant.ts              # Injeta req.organizationId
│   │   ├── services/
│   │   │   ├── evolutionApi.ts        # Cliente HTTP para a Evolution API
│   │   │   ├── sseManager.ts          # Gerencia conexões SSE abertas
│   │   │   └── webhookProcessor.ts    # Lógica de processamento do webhook
│   │   ├── db/
│   │   │   ├── index.ts               # Conexão com Neon (postgres.js)
│   │   │   ├── schema.sql             # Schema completo (source of truth)
│   │   │   └── seed.ts                # Seed para criar organização inicial
│   │   └── app.ts                     # Express app + rotas
│   ├── .env                           # variáveis de ambiente (não comitar)
│   └── package.json
│
└── README.md
```

---

## 7. Ordem de Desenvolvimento Recomendada

A sequência abaixo garante que algo funcional exista o mais cedo possível, cada etapa entrega valor testável.

### Fase 1 — Fundação (banco + auth) ✅ Concluída
1. Criar projeto Neon, rodar schema SQL
2. Configurar backend Express com Auth.js (login/logout com email+senha, cookie-based)
3. Implementar middleware de tenant (extrai `organization_id` da sessão Auth.js)
4. Seed: criar organização e usuário owner da primeira cliente
5. Login funcional com redirecionamento para inbox

### Fase 2A — Evolution API deployada ✅ Concluída
1. Deploy da Evolution API no Fly.io com Dockerfile customizado
2. Banco `evolution_api` no Neon conectado via `DATABASE_CONNECTION_URI`
3. API respondendo autenticada

### Fase 2B — Webhook + rotas de backend (pendente)
1. Implementar `POST /webhooks/evolution` com processamento completo
2. UPSERT de clients e conversations ao receber mensagem
3. Testar: mandar mensagem no WhatsApp → aparece no banco → aparece na inbox

### Fase 3 — Caixa de entrada ✅ Concluída
1. Backend: `GET /api/v1/conversations`, `GET /api/v1/conversations/:id`, `POST /api/v1/messages`
2. Backend: endpoint SSE `GET /api/events`
3. Frontend: ConversationList + MessageThread + useSSE hook
4. Frontend atualiza em tempo real via SSE

### Fase 4 — Clientes (próxima)
1. Backend: CRUD completo (`GET`, `POST`, `PATCH`, `DELETE /api/v1/clients`)
2. Frontend: página de clientes com sistema de abas
3. Cada cliente abre em aba própria com histórico de conversa
4. Testar: cadastrar cliente manualmente, abrir múltiplas abas

### Fase 5 — Empresas
1. Backend: CRUD de empresas (`/api/v1/companies`) + vinculação de clientes
2. Frontend: página de empresas com lista e formulário
3. Vincular clientes a empresas dentro da aba da empresa

### Fase 6 — Lembretes
1. Backend: CRUD de lembretes (`/api/v1/reminders`)
2. Frontend: listagem + criação de lembretes vinculados a clientes
3. Polling a cada 60s para notificações de lembretes vencidos

### Fase 7 — Gerenciamento WhatsApp
1. Backend: rotas `/api/v1/whatsapp/status`, `/connect`, `/disconnect`
2. Frontend: painel de status + QR Code
3. Conectar instância junto com a primeira cliente

### Fase 8 — Deploy final
1. Deploy do frontend no Vercel
2. Deploy do backend no Railway
3. Variáveis de ambiente configuradas em produção
4. Teste end-to-end com a primeira cliente

---

## 8. Variáveis de Ambiente

### Backend (`backend/.env`)

```env
# Banco de dados
DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require

# Auth.js
AUTH_SECRET=string_aleatoria_minimo_32_chars
AUTH_URL=https://[backend-railway-url]

# Evolution API
EVOLUTION_API_URL=https://[evolution-railway-url]
EVOLUTION_API_KEY=chave_global_da_evolution_api
EVOLUTION_WEBHOOK_SECRET=string_secreta_para_validar_webhooks

# CORS
FRONTEND_URL=https://[frontend-vercel-url]

# Ambiente
NODE_ENV=production
PORT=3000
```

### Frontend (`frontend/.env.local`)

```env
# Backend
VITE_API_URL=https://[backend-railway-url]

# Auth.js
VITE_AUTH_URL=https://[backend-railway-url]/api/auth
```

**Regras de segurança:**
- `.env` e `.env.local` estão no `.gitignore` — nunca comitar
- Variáveis no Railway e Vercel configuradas via painel, nunca em código
- `EVOLUTION_WEBHOOK_SECRET` deve ter no mínimo 32 caracteres aleatórios
- `AUTH_SECRET` gerado com `openssl rand -base64 32`

---

## 9. Segurança Multi-Tenant

### Princípio de Isolamento

Todo dado de negócio pertence a uma organização. O `organization_id` é o mecanismo de isolamento — nunca confiamos no frontend para dizer a qual organização um dado pertence.

### Camadas de Segurança

**Camada 1 — JWT:**
- `organization_id` é embutido no token pelo backend no momento do login
- Frontend nunca pode alterar o `organization_id` de um token válido
- Tokens expiram (configurar `expiresIn: '8h'` ou similar)

**Camada 2 — Middleware de Tenant:**
```typescript
// middleware/tenant.ts
export function tenantMiddleware(req, res, next) {
  // organizationId já validado pelo middleware de auth
  req.organizationId = req.user.organizationId;
  next();
}
```

**Camada 3 — Queries sempre filtradas:**
```typescript
// CORRETO — sempre com organization_id
const contacts = await db.query(
  'SELECT * FROM contacts WHERE organization_id = $1',
  [req.organizationId]
);

// NUNCA FAZER — sem filtro de tenant
const contacts = await db.query('SELECT * FROM contacts');
```

**Camada 4 — Validação de ownership antes de mutação:**
```typescript
// Antes de editar/deletar, verificar que o recurso pertence ao tenant
const contact = await db.query(
  'SELECT id FROM contacts WHERE id = $1 AND organization_id = $2',
  [contactId, req.organizationId]
);
if (!contact.rows[0]) return res.status(404).json({ error: 'Not found' });
```

**Camada 5 — Webhook sem JWT (validado por secret):**
```typescript
// webhooks.ts
const secret = req.headers['x-evolution-secret'];
if (secret !== process.env.EVOLUTION_WEBHOOK_SECRET) {
  return res.status(401).json({ error: 'Unauthorized' });
}
// Tenant identificado pelo instanceName, não por JWT
```

### O que Nunca Fazer

- ❌ Receber `organization_id` do body ou query params em rotas protegidas
- ❌ Fazer queries sem `WHERE organization_id = $1`
- ❌ Retornar erros que revelem existência de dados de outros tenants (usar 404, não 403)
- ❌ Logar dados sensíveis (conteúdo de mensagens, tokens, API keys)
- ❌ Hardcodar credenciais em qualquer arquivo do repositório

---

## 10. Decisões Arquiteturais Registradas

| Decisão | Escolha | Motivo |
|---|---|---|
| Autenticação | Auth.js | Mais rápido de implementar, suporte a JWT, adequado para dev solo iniciante |
| Tempo real | SSE | Suficiente para o MVP (só servidor → cliente), mais simples que WebSocket |
| Mídia | Fora do MVP | Somente texto no v1 — reduz complexidade de armazenamento e edge cases |
| Super admin | Manual via SQL | Overhead desnecessário com um único tenant ativo |
| Evolution API | Self-hosted no Railway | Gratuito, sem limites artificiais de API, controle total |
| Multi-tenant | organization_id em todas as tabelas | Isolamento desde o dia 1, sem refatoração futura |
| Estado frontend | A definir (Zustand recomendado) | Necessário para abas de contatos e SSE |

---

## 11. Contexto Adicional para o Claude Code

- **Desenvolvedor:** solo, nível iniciante — prefere implementações explícitas com comentários explicativos no código, evite "magia" implícita
- **Custo:** priorizar tiers gratuitos (Neon free, Railway free tier, Vercel free)
- **Sem testes automatizados no MVP** — validação manual por enquanto
- **TypeScript no frontend** — backend pode ser JavaScript ou TypeScript (a definir)
- **Drag and drop no Kanban:** usar `@dnd-kit/core` (mais moderno que react-beautiful-dnd)
- **Sistema de abas de contatos:** estado gerenciado no frontend (array de contatos abertos), não persistido no servidor
- **Nome do produto:** não definido — usar placeholder `[NOME]` até decisão do fundador
- **Primeiro deploy:** Railway e Vercel free tiers — observar limites de sleep e cold start
- **Evolution API:** não suporta SQLite — requer PostgreSQL ou MySQL
- **Auth.js v5:** endpoint de login com credentials é `POST /api/auth/callback/credentials`, não `/api/auth/signin`
- **Evolution API hospedagem:** self-hosted no Fly.io (não Railway, para não onerar os bots existentes do dev)

---

## 12. Estado Atual do Projeto

**Última sessão:** 2026-04-28

**O que foi feito:**
- Reset de escopo: Pipeline Kanban removido; novos módulos adicionados (Clientes, Empresas, Lembretes)
- Schema do banco reescrito do zero com novas tabelas: `companies`, `company_contacts`, `clients`, `reminders`; `conversations` agora referencia `clients` (não `contacts`); `messages` usa `created_at` e índice único parcial em `whatsapp_message_id`
- Auth migrada para cookie-based (Auth.js session) — sem Bearer token no frontend
- Inbox completa: ConversationList, MessageThread, useSSE hook, SSE endpoint, rotas de conversas e mensagens
- Login funcional, inbox exibindo conversas em tempo real

**Pendências:**
- Fase 2B: implementar `POST /webhooks/evolution` (webhook processor com UPSERT de clients)
- Fase 4: módulo Clientes (CRUD backend + frontend com abas)
- Fase 5: módulo Empresas
- Fase 6: módulo Lembretes
- Fase 7: gerenciamento WhatsApp (QR Code, status)
- Fase 8: deploy completo (backend Railway, frontend Vercel)

**Detalhes técnicos importantes — Evolution API no Fly.io:**
- App: `melao-evolution-api.fly.dev`
- API Key: secret `AUTHENTICATION_API_KEY` no Fly.io (valor: `YOUR_EVOLUTION_API_KEY`)
- Banco: `evolution_api` no Neon (projeto melao-gestor), conectado via URL direta (sem pooler) em `DATABASE_CONNECTION_URI`
- Dockerfile customizado em `evolution/` com `docker-entrypoint.sh` que corrige o `.env` da imagem antes do startup
- `SERVER_URL` deve apontar para `https://melao-evolution-api.fly.dev`

**Schema atual — tabelas principais:**
- `organizations`, `users`, `evolution_instances`
- `clients` (whatsapp, name, company_name, notes, tags)
- `companies` (name, domain, notes, tags) + `company_contacts` (pivot)
- `conversations` (client_id nullable, whatsapp_chat_id, unread_count)
- `messages` (direction 'in'/'out', content, created_at)
- `reminders` (client_id, title, due_at, done)

## Design System

Siga o arquivo DESIGN.md na raiz do projeto para todas as decisões visuais.
Nunca use emojis em UI. Ícones exclusivamente via Lucide React.
Cor de accent do produto: #F2E600 — substitui qualquer accent color definido no DESIGN.md.
Cores com classes Tailwind arbitrárias como bg-[#F2E600] não funcionam neste projeto — use sempre style={{ backgroundColor: "#F2E600" }} para aplicar essa cor.