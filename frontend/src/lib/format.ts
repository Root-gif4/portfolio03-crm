import type { Outlook, Priority, ProjectStatus, Role, TaskStatus } from './types'

export const PROJECT_STATUS: Record<ProjectStatus, string> = {
  lead: '見込み',
  proposal: '提案中',
  negotiation: '交渉中',
  won: '受注',
  lost: '失注',
}
export const PROJECT_STATUS_ORDER: ProjectStatus[] = ['lead', 'proposal', 'negotiation', 'won', 'lost']
export const TASK_STATUS: Record<TaskStatus, string> = { todo: '未着手', doing: '対応中', done: '完了' }
export const PRIORITY: Record<Priority, string> = { high: '高', medium: '中', low: '低' }
export const OUTLOOK: Record<Outlook, string> = { on_track: '予定どおり', at_risk: '遅れそう' }
export const ROLE: Record<Role, string> = { admin: '管理者', manager: 'マネージャー', member: 'メンバー' }
export const ACTION: Record<string, string> = {
  create: '追加',
  update: '変更',
  delete: '削除',
  login: 'ログイン',
  logout: 'ログアウト',
  login_failed: 'ログイン失敗',
  password_change: 'パスワード変更',
  password_reset: 'パスワード再設定',
}
export const ENTITY: Record<string, string> = { customer: '顧客', project: '案件', task: 'タスク', user: 'ユーザー', seed: '見本データ' }

const yenFmt = new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' })
export const yen = (n: number) => yenFmt.format(n)

/** 「120万円」のように短く（グラフの目盛り用） */
export function manYen(n: number): string {
  if (n >= 100_000_000) return `${(n / 100_000_000).toFixed(1).replace(/\.0$/, '')}億円`
  if (n >= 10_000) return `${Math.round(n / 10_000).toLocaleString('ja-JP')}万円`
  return `${n.toLocaleString('ja-JP')}円`
}

export function date(s: string | null | undefined): string {
  if (!s) return '—'
  const d = new Date(s.length === 10 ? `${s}T00:00:00` : s)
  return d.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Tokyo' })
}

export function dateTime(s: string | null | undefined): string {
  if (!s) return '—'
  return new Date(s).toLocaleString('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo',
  })
}

/** 今日から何日後か（負なら何日前） */
export function daysFrom(today: string, s: string): number {
  return Math.round((new Date(`${s}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86_400_000)
}

export function todayJst(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' })
}

export function dueLabel(due: string | null, today = todayJst()): string {
  if (!due) return '期限なし'
  const d = daysFrom(today, due)
  if (d < 0) return `${-d}日超過`
  if (d === 0) return '今日まで'
  if (d === 1) return '明日まで'
  return `あと${d}日`
}

/** 「11/05」のように短く */
export function shortDate(s: string | null | undefined): string {
  if (!s) return '—'
  return `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`
}

/** 期間「11/05 → 11/20」（終わりがなければ「11/05 →」） */
export function period(start: string, end: string | null): string {
  return `${shortDate(start)} → ${end ? shortDate(end) : ''}`.trim()
}

/** 開始日から見た今の位置（「開始から 5 日目」「3 日後に開始」） */
export function sinceLabel(start: string, today = todayJst()): string {
  const d = daysFrom(start, today)
  if (d < 0) return `${-d}日後に開始`
  if (d === 0) return '今日から開始'
  return `開始から${d + 1}日目`
}

/** 日付の足し算（'YYYY-MM-DD' のまま。時差の影響を受けないよう UTC で計算する） */
export function addDays(s: string, n: number): string {
  const d = new Date(`${s}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function addMonths(s: string, n: number): string {
  const d = new Date(`${s.slice(0, 7)}-01T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + n)
  return d.toISOString().slice(0, 10)
}

/** 曜日（0＝日曜） */
export function weekday(s: string): number {
  return new Date(`${s}T00:00:00Z`).getUTCDay()
}
