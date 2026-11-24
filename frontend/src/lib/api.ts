// API の呼び出し。Cookie（HttpOnly）でログインを保ち、書き換えには CSRF 対策のヘッダーを付ける。

export class ApiError extends Error {
  status: number
  field: string | null
  errors: { field: string; message: string }[]

  constructor(status: number, message: string, field: string | null = null, errors: { field: string; message: string }[] = []) {
    super(message)
    this.status = status
    this.field = field
    this.errors = errors
  }
}

type Query = Record<string, string | number | boolean | string[] | null | undefined>

export function toQuery(params: Query): string {
  const q = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '' || value === false) continue
    if (Array.isArray(value)) value.forEach((v) => q.append(key, v))
    else q.append(key, String(value))
  }
  const s = q.toString()
  return s ? `?${s}` : ''
}

let onUnauthorized: (() => void) | null = null
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (method !== 'GET') headers['X-Requested-With'] = 'crm-app'
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  let res: Response
  try {
    res = await fetch(url, { method, headers, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body) })
  } catch {
    throw new ApiError(0, 'サーバーにつながりません。アプリが起動しているか確認してください。')
  }
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (res.status === 401 && !url.endsWith('/api/auth/login') && onUnauthorized) onUnauthorized()
    throw new ApiError(res.status, data.message ?? 'エラーが起きました。', data.field ?? null, data.errors ?? [])
  }
  return data as T
}

export const api = {
  get: <T>(url: string, params: Query = {}) => request<T>('GET', url + toQuery(params)),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T>(url: string, body: unknown) => request<T>('PUT', url, body),
  patch: <T>(url: string, body: unknown) => request<T>('PATCH', url, body),
  del: (url: string) => request<void>('DELETE', url),
}
