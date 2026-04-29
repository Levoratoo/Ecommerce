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
1. **Autenticação** — login com email e senha, cookie-based via Auth.js, 1 usuário por organização
2. **Caixa de entrada WhatsApp** — conversas em tempo real, badge de não lidas, nome da empresa abaixo do cliente (ou badge "Sem empresa"), envio e recebimento via Evolution API
3. **Clientes** — duas formas de entrada: automática via WhatsApp (sem empresa, badge "Sem empresa") e manual (modal com nome, email, WhatsApp, observações e empresa obrigatória); abas por cliente no frontend
4. **Empresas** — múltiplas empresas por usuária; cadastro via modal (nome, CNPJ, email, telefone, observações); cada empresa tem tela própria com dados, contatos internos e lembretes vinculados
5. **Lembretes** — título, descrição, data/hora, vínculo com cliente ou empresa, notificação visual via polling a cada 60s

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
-- ORGANIZATIONS
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- USERS (1 por organização)
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- EVOLUTION API INSTANCES (1 por organização)
CREATE TABLE evolution_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  instance_name VARCHAR(255) NOT NULL UNIQUE,
  api_url VARCHAR(500) NOT NULL,
  api_key VARCHAR(500) NOT NULL,
  phone_number VARCHAR(50),
  status VARCHAR(50) DEFAULT 'disconnected',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- COMPANIES (empresas contratantes — múltiplas por usuária)
CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  cnpj VARCHAR(20),
  email VARCHAR(255),
  phone VARCHAR(50),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- COMPANY_CONTACTS (pessoas dentro de cada empresa)
CREATE TABLE company_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(255),
  email VARCHAR(255),
  whatsapp VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- CLIENTS (clientes finais / B2C)
-- company_id nullable: clientes que chegam via WhatsApp entram sem empresa
CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  company_id UUID REFERENCES companies(id) ON DELETE SET NULL,
  name VARCHAR(255),
  email VARCHAR(255),
  whatsapp VARCHAR(50),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id, whatsapp)
);

-- CONVERSATIONS
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
  whatsapp_chat_id VARCHAR(255) NOT NULL,
  last_message_at TIMESTAMPTZ,
  unread_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(organization_id, whatsapp_chat_id)
);

-- MESSAGES
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  whatsapp_message_id VARCHAR(255),
  direction VARCHAR(10) NOT NULL,  -- 'in' | 'out'
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Evita duplicatas de webhook quando whatsapp_message_id está presente
CREATE UNIQUE INDEX idx_messages_whatsapp_id
  ON messages(organization_id, whatsapp_message_id)
  WHERE whatsapp_message_id IS NOT NULL;

-- REMINDERS (vinculados a client ou company via linked_type + linked_id)
CREATE TABLE reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  due_at TIMESTAMPTZ NOT NULL,
  completed BOOLEAN DEFAULT FALSE,
  linked_type VARCHAR(20),  -- 'client' | 'company' | null
  linked_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 4. API Backend — Endpoints

**Base URL:** `https://[backend-railway-url]/api/v1`  
**Auth:** todas as rotas (exceto `/api/auth` e `/webhooks`) exigem sessão cookie válida (Auth.js).  
**Middleware de tenant:** extrai `organization_id` da sessão Auth.js e injeta em `req.organizationId`.

### Autenticação (`/api/auth`)

Cookie-based via Auth.js v5. Fluxo do frontend:
```
GET  /api/auth/csrf                     — obtém CSRF token
POST /api/auth/callback/credentials    — login com email/senha (form-urlencoded + csrfToken)
GET  /api/auth/session                 — sessão atual (user.id, user.organizationId)
POST /api/auth/signout                 — logout
```

---

### Conversas

```
GET  /api/v1/conversations
  → lista conversas do tenant ordenadas por last_message_at DESC
  → inclui: id, client.{id,name,whatsapp,company:{id,name}}, last_message_at, unread_count
  → query params: ?page=1&limit=20

GET  /api/v1/conversations/:id
  → detalhes da conversa + últimas 50 mensagens em ordem cronológica

POST /api/v1/conversations/:id/read
  → zera unread_count da conversa
```

---

### Mensagens

```
POST /api/v1/messages
  → envia mensagem de texto via Evolution API
  → body: { conversation_id: string, content: string }
  → salva no banco com direction: 'out', emite SSE
  → retorna a mensagem salva
```

---

### Clientes

```
GET  /api/v1/clients
  → lista clientes do tenant
  → inclui company aninhada quando vinculada
  → query params: ?search=nome&page=1&limit=20

GET  /api/v1/clients/:id
  → detalhes do cliente + conversa vinculada

POST /api/v1/clients
  → cadastro manual
  → body: { name, whatsapp, email?, notes?, company_id (obrigatório) }

PATCH /api/v1/clients/:id
  → edição parcial: name?, email?, notes?, company_id?

DELETE /api/v1/clients/:id
  → remoção permanente
```

---

### Empresas

```
GET  /api/v1/companies
  → lista empresas do tenant

GET  /api/v1/companies/:id
  → dados da empresa + contatos internos + lembretes vinculados

POST /api/v1/companies
  → cadastro
  → body: { name, cnpj?, email?, phone?, notes? }

PATCH /api/v1/companies/:id
  → edição parcial

DELETE /api/v1/companies/:id
  → remoção (clients com essa empresa ficam com company_id = null)
```

---

### Lembretes

```
GET  /api/v1/reminders
  → lista lembretes do tenant, ordenados por due_at ASC
  → query params: ?linked_type=client&linked_id=uuid

POST /api/v1/reminders
  → body: { title, description?, due_at, linked_type?, linked_id? }

PATCH /api/v1/reminders/:id
  → edição parcial: title?, description?, due_at?, completed?

DELETE /api/v1/reminders/:id
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

### Fase 4 — Clientes ✅ Concluída
1. Backend: CRUD completo (`GET`, `POST`, `PATCH`, `DELETE /api/v1/clients`) — com filtros `?search=` e `?company_id=`
2. Frontend: layout completo com AppSidebar + ClientColumn + sistema de abas
3. Cada cliente abre em aba própria com histórico de conversa e painel de detalhes

### Fase 5 — Empresas (backend ✅ / frontend UI pendente)
1. Backend: CRUD de empresas (`/api/v1/companies`) ✅
2. Frontend: modal de criação via sidebar ✅ — tela de detalhes da empresa (contatos internos) pendente
3. Empresas aparecem na sidebar com ícone colorido por índice; filtram clientes por empresa ✅

### Fase 6 — Lembretes (backend ✅ / formulário de criação pendente)
1. Backend: CRUD de lembretes (`/api/v1/reminders`) com filtros `?linked_type=&linked_id=` ✅
2. Frontend: visualização no ClientDetailPanel e na view "Lembretes" da sidebar ✅ — formulário de criação pendente
3. Polling de notificações — pendente

### Fase 7 — Gerenciamento WhatsApp
1. Backend: rotas `/api/v1/whatsapp/status`, `/connect`, `/disconnect`
2. Frontend: painel de status + QR Code
3. Conectar instância junto com a primeira cliente

### Fase 8 — Deploy final
1. Deploy do frontend no Vercel
2. Deploy do backend no Railway
3. Variáveis de ambiente configuradas em produção
4. Teste end-to-end com a primeira cliente

### Fase 9 — Inteligência Artificial (pós-deploy)

**Contexto:** funcionalidades de IA integradas ao CRM para aumentar a produtividade da usuária. Todas as chamadas de IA passam pelo backend — a chave da API nunca é exposta no frontend. **O provedor de IA não está definido** — avaliar custo/benefício entre opções com free tier generoso antes de implementar.

**Candidatos a provedor (prioridade: custo baixo ou free tier):**
- **Groq** — inferência extremamente rápida, free tier generoso (modelos LLaMA/Mixtral)
- **DeepSeek** — custo por token muito baixo, API compatível com OpenAI SDK
- **OpenAI** — referência de mercado, sem free tier mas custo baixo em modelos menores (gpt-4o-mini)
- **Anthropic (Claude API)** — qualidade alta, sem free tier; considerar apenas se custo for viável

**Funcionalidades planejadas — por prioridade:**

**Alta prioridade:**
1. **Resumo de conversa** — botão na thread que gera um parágrafo com o histórico da conversa; evita reler tudo após dias sem contato
2. **Sugestão de resposta** — botão "Sugerir resposta" no input; IA analisa as últimas mensagens e propõe um rascunho editável
3. **Classificação de urgência** — ao receber mensagem nova, classifica como Alta / Média / Baixa; exibe badge na lista de conversas

**Média prioridade:**
4. **Análise de sentimento** — badge visual (satisfeito / neutro / insatisfeito) baseado no tom das últimas mensagens
5. **Sugestão de lembrete** — quando IA detecta data ou compromisso na conversa, exibe botão "Criar lembrete para isso"
6. **Extração de entidades** — detecta datas, valores e nome de empresa na conversa e sugere atualizar o cadastro do cliente

**Pós-MVP:**
7. **Auto-tagging** — categoriza o cliente por assunto predominante (suporte, vendas, financeiro)

**Princípio de implementação:** todas as features de IA devem ser opcionais e não bloquear o fluxo principal. Se a chamada de IA falhar, o CRM continua funcionando normalmente.

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
- CRUD de clientes no backend com filtros `?search=` e `?company_id=`
- CRUD de empresas no backend (GET, POST, PATCH, DELETE)
- CRUD de lembretes no backend — rota nova `GET/POST/PATCH/DELETE /api/v1/reminders` com filtros por `linked_type` e `linked_id`
- Novo layout completo do frontend reconstruído a partir de mockup HTML:
  - `AppSidebar` (64px, fundo #111) — avatar do usuário, ícones de empresa por cor de índice, botão nova empresa (borda tracejada), ícones "Todos os clientes" e "Lembretes", botão sair
  - `ClientColumn` (240px) contextual — muda para clientes da empresa selecionada, todos os clientes, ou lista de lembretes
  - `ChatMessages` — cabeçalho com nome · empresa · whatsapp, histórico de mensagens, input pill com botão de envio circular
  - `ClientDetailPanel` (220px, painel direito) — avatar, info do cliente, lembretes pendentes
  - `AppPage` — orquestrador único com todo o estado; navegação por estado interno, sem mudança de rota; sistema de abas
  - `NewCompanyModal` — criação de empresa direto pela sidebar
  - `NewClientModal` atualizado com `defaultCompanyId` para pré-selecionar empresa no contexto de empresa ativa
- `App.tsx` simplificado para rota única `/* → AppPage`

**Pendências:**
- Fase 2B: implementar `POST /webhooks/evolution` (webhook processor com UPSERT de clients)
- Fase 5 (UI): tela de detalhes da empresa — contatos internos, lembretes vinculados à empresa
- Fase 6 (UI): formulário de criação de lembretes; polling de notificações de lembretes vencidos
- Fase 7: gerenciamento WhatsApp (QR Code, status da instância)
- Fase 8: deploy completo (backend Railway, frontend Vercel)

**Detalhes técnicos importantes — Evolution API no Fly.io:**
- App: `melao-evolution-api.fly.dev`
- API Key: secret `AUTHENTICATION_API_KEY` no Fly.io (valor: `YOUR_EVOLUTION_API_KEY`)
- Banco: `evolution_api` no Neon (projeto melao-gestor), conectado via URL direta (sem pooler) em `DATABASE_CONNECTION_URI`
- Dockerfile customizado em `evolution/` com `docker-entrypoint.sh` que corrige o `.env` da imagem antes do startup
- `SERVER_URL` deve apontar para `https://melao-evolution-api.fly.dev`

**Schema atual — tabelas principais:**
- `organizations`, `users`, `evolution_instances`
- `companies` (name, cnpj, email, phone, notes) + `company_contacts` (contatos internos)
- `clients` (company_id nullable FK → companies, whatsapp, name, email, notes)
- `conversations` (client_id nullable, whatsapp_chat_id, unread_count)
- `messages` (direction 'in'/'out', content, created_at; UNIQUE parcial em whatsapp_message_id)
- `reminders` (linked_type 'client'|'company', linked_id, title, due_at, completed)

## Design System

Siga o arquivo DESIGN.md na raiz do projeto para todas as decisões visuais.
Nunca use emojis em UI. Ícones exclusivamente via Lucide React.
Cor de accent do produto: #F2E600 — substitui qualquer accent color definido no DESIGN.md.
Cores com classes Tailwind arbitrárias como bg-[#F2E600] não funcionam neste projeto — use sempre style={{ backgroundColor: "#F2E600" }} para aplicar essa cor.