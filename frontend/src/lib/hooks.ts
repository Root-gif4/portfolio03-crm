import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router'
import { api } from './api'
import type { Ref } from './types'

/** 担当者の選択肢（使用中のユーザー） */
export function useUserOptions() {
  return useQuery({ queryKey: ['users', 'options'], queryFn: () => api.get<Ref[]>('/api/users/options'), staleTime: 60_000 })
}

/** 絞り込みの条件を URL に持つ（ブラウザの戻る・リンクの共有で同じ一覧が出る） */
export function useFilters<T extends Record<string, string>>(defaults: T): [T, (patch: Partial<T>) => void] {
  const [params, setParams] = useSearchParams()
  const values = { ...defaults }
  for (const key of Object.keys(defaults) as (keyof T)[]) {
    const v = params.get(key as string)
    if (v !== null) values[key] = v as T[keyof T]
  }
  const update = (patch: Partial<T>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === '' || v === defaults[k]) next.delete(k)
      else next.set(k, String(v))
    }
    if (!('page' in patch)) next.delete('page') // 条件を変えたら 1 ページ目へ
    setParams(next, { replace: true })
  }
  return [values, update]
}
