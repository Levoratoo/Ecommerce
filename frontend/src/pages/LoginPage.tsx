import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { MessageSquare, Users, Kanban } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { login } from '@/lib/auth'
import { useAuthStore } from '@/store/auth'

const features = [
  {
    Icon: MessageSquare,
    title: 'Caixa de entrada unificada',
    desc: 'Todas as conversas do WhatsApp em um painel centralizado.',
  },
  {
    Icon: Users,
    title: 'Contatos organizados',
    desc: 'Cadastre clientes e acesse o histórico completo de cada conversa.',
  },
  {
    Icon: Kanban,
    title: 'Pipeline de vendas',
    desc: 'Visualize e mova seus leads com um Kanban intuitivo.',
  },
]

// Estilo base dos inputs: sobrescreve os padrões do shadcn
const inputClass =
  'h-auto rounded-lg border-[#E0E0E0] px-4 py-3 text-sm placeholder:text-gray-300 focus-visible:ring-melon-400 focus-visible:ring-offset-0'

export default function LoginPage() {
  const navigate = useNavigate()
  const setAuth = useAuthStore((s) => s.setAuth)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const result = await login(email, password)
      setAuth(result.user, result.token)
      navigate('/inbox')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao fazer login')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex">

      {/* ── Painel esquerdo — formulário ── */}
      <div className="flex-1 bg-white flex flex-col min-w-0">

        {/* Logo — com respiro generoso do canto */}
        <header className="px-10 py-8">
          <span className="text-xl font-semibold tracking-tight text-gray-900">
            Melão
          </span>
        </header>

        {/* Formulário — centralizado verticalmente */}
        <div className="flex-1 flex items-center justify-center px-8 pb-16">
          <div className="w-full max-w-[360px] flex flex-col gap-6">

            <h1 className="text-[28px] font-semibold leading-tight text-gray-900">
              Entrar na sua conta
            </h1>

            <form onSubmit={handleSubmit} className="flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email" className="text-sm font-medium text-gray-700">
                  Endereço de email
                </Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="seu@email.com"
                  className={inputClass}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="password" className="text-sm font-medium text-gray-700">
                  Senha
                </Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className={inputClass}
                />
              </div>

              {error && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-4 py-3">
                  {error}
                </p>
              )}

              <Button
                type="submit"
                disabled={loading}
                className="w-full h-12 rounded-lg bg-[#F5E642] hover:bg-[#e8d93a] text-gray-900 font-semibold text-sm shadow-none"
              >
                {loading ? 'Entrando...' : 'Entrar'}
              </Button>
            </form>

          </div>
        </div>
      </div>

      {/* ── Painel direito — apresentação ── */}
      <div className="hidden lg:flex w-[420px] shrink-0 flex-col justify-end p-10 bg-[#F5E642]">
        <div className="flex flex-col gap-8">

          {/* Título */}
          <h2
            className="text-gray-900"
            style={{ fontSize: '30px', fontWeight: 700, lineHeight: 1.2 }}
          >
            Atendimento pelo WhatsApp, sem perder nenhum lead.
          </h2>

          {/* Feature bullets */}
          <div className="flex flex-col gap-5">
            {features.map(({ Icon, title, desc }) => (
              <div key={title} className="flex gap-3 items-start">
                <div className="w-8 h-8 rounded-lg bg-black/10 flex items-center justify-center shrink-0 mt-0.5">
                  <Icon size={15} strokeWidth={2} className="text-gray-900" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-900">{title}</p>
                  <p className="text-sm text-gray-700 mt-0.5 leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Rodapé do painel */}
          <p className="text-xs text-gray-600">Melão — CRM para WhatsApp</p>
        </div>
      </div>

    </div>
  )
}
