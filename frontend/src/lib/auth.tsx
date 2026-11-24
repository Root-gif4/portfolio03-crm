import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, type ReactNode } from 'react'
import { api, ApiError, setUnauthorizedHandler } from './api'
import { SHOWN_KEY } from './reminder'
import type { Me } from './types'

interface AuthValue {
  me: Me | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api.get<Me>('/api/auth/me')
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null
        throw e
      }
    },
    staleTime: 60_000,
  })

  useEffect(() => {
    // どの API でもログインが切れていたら、ログイン画面へ戻す
    setUnauthorizedHandler(() => {
      qc.setQueryData(['me'], null)
    })
  }, [qc])

  const login = useCallback(async (email: string, password: string) => {
    const me = await api.post<Me>('/api/auth/login', { email, password })
    sessionStorage.removeItem(SHOWN_KEY) // ログインしたら、期限のお知らせをもう一度出す
    // 前の人のデータを残さない（me の問い合わせは画面が見ているので消さずに中身だけ入れ替える）
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' })
    qc.setQueryData(['me'], me)
  }, [qc])

  const logout = useCallback(async () => {
    await api.post('/api/auth/logout').catch(() => undefined)
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' })
    qc.setQueryData(['me'], null)
  }, [qc])

  return <AuthContext.Provider value={{ me: data ?? null, loading: isLoading, login, logout }}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const v = useContext(AuthContext)
  if (!v) throw new Error('AuthProvider の中で使ってください')
  return v
}

export function useMe(): Me {
  const { me } = useAuth()
  if (!me) throw new Error('ログインしていません')
  return me
}
