import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import { Icon } from '../components/Icon'
import { LastReport, ProgressView, ReportDialog } from '../components/Report'
import { Card, ConfirmDialog, Empty, ErrorBox, Loading, PageHeader, Pagination, PriorityBadge, TaskBadge, useToast } from '../components/ui'
import { api } from '../lib/api'
import { dueLabel, period, sinceLabel, TASK_STATUS } from '../lib/format'
import { useFilters, useUserOptions } from '../lib/hooks'
import type { Page, Task, TaskStatus } from '../lib/types'
import { TaskForm } from './forms'

const PER_PAGE = 30

/** タスクの表。「完了にする」ボタンで完了、「元に戻す」で未着手に戻せる（権限のあるものだけ） */
export function TaskTable({ params, hideProject, onPage }: {
  params: Record<string, string | number | boolean | string[]>; hideProject?: boolean; onPage?: (p: number) => void
}) {
  const qc = useQueryClient()
  const toast = useToast()
  const [editing, setEditing] = useState<Task | null>(null)
  const [deleting, setDeleting] = useState<Task | null>(null)
  const [reporting, setReporting] = useState<Task | null>(null)
  const { data, isLoading, error } = useQuery({
    queryKey: ['tasks', params],
    queryFn: () => api.get<Page<Task>>('/api/tasks', params),
    placeholderData: (prev) => prev,
  })
  const refresh = () => {
    for (const k of ['tasks', 'project', 'projects', 'dashboard']) void qc.invalidateQueries({ queryKey: [k] })
  }
  const status = useMutation({
    mutationFn: ({ t, s }: { t: Task; s: TaskStatus }) => api.patch<Task>(`/api/tasks/${t.id}/status`, { status: s, version: t.version }),
    onSuccess: (t) => { toast('success', `「${t.title}」を${TASK_STATUS[t.status]}にしました`); refresh() },
    onError: (e) => { toast('error', e.message); refresh() },
  })
  const del = useMutation({
    mutationFn: (t: Task) => api.del(`/api/tasks/${t.id}`),
    onSuccess: () => { toast('success', 'タスクを削除しました'); setDeleting(null); refresh() },
    onError: (e) => { toast('error', e.message); setDeleting(null) },
  })

  if (isLoading) return <Loading />
  if (error) return <ErrorBox error={error} />
  if (!data || !data.items.length) return <Empty icon="tasks" title="タスクはありません" />

  return (
    <>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>やること</th>{!hideProject && <th>案件・顧客</th>}<th>期間（開始 → 期限）</th><th>担当</th><th>進み具合</th><th aria-label="変更・削除" /></tr></thead>
          <tbody>
            {data.items.map((t) => (
              <tr key={t.id} className={t.status === 'done' ? 'is-done' : ''}>
                <td><strong className="task-title">{t.title}</strong> <PriorityBadge priority={t.priority} /></td>
                {!hideProject && <td><Link to={`/projects/${t.project.id}`}>{t.project.name}</Link><br /><span className="muted small">{t.customer.name}</span></td>}
                <td>
                  <span className="nowrap">{period(t.start_date, t.due_date)}</span><br />
                  {t.status === 'done'
                    ? <span className="muted small">完了済み</span>
                    : <span className="small"><span className={`due ${t.overdue ? 'due-over' : ''}`}>{dueLabel(t.due_date)}</span><span className="muted">・{sinceLabel(t.start_date)}</span></span>}
                </td>
                <td>{t.assignee?.name ?? '（未定）'}</td>
                <td>
                  <div className="progress-cell">
                    {t.can_edit && t.status !== 'done' ? (
                      <>
                        <select className="inline-select" value={t.status} aria-label={`「${t.title}」の状態`}
                          onChange={(e) => status.mutate({ t, s: e.target.value as TaskStatus })} disabled={status.isPending}>
                          <option value="todo">{TASK_STATUS.todo}</option>
                          <option value="doing">{TASK_STATUS.doing}</option>
                        </select>
                        <button type="button" className="btn btn-sm btn-done" disabled={status.isPending}
                          onClick={() => status.mutate({ t, s: 'done' })} aria-label={`「${t.title}」を完了にする`}>
                          <Icon name="check" size={15} /> 完了にする
                        </button>
                        <button type="button" className="btn btn-sm" onClick={() => setReporting(t)} aria-label={`「${t.title}」の進み具合を報告`}>
                          <Icon name="report" size={15} /> 報告
                        </button>
                      </>
                    ) : (
                      <>
                        <TaskBadge status={t.status} />
                        {t.can_edit && (
                          <button type="button" className="btn-text" disabled={status.isPending}
                            onClick={() => status.mutate({ t, s: 'todo' })} aria-label={`「${t.title}」を未着手に戻す`}>
                            <Icon name="undo" size={13} /> 元に戻す
                          </button>
                        )}
                        {!t.can_edit && <span className="muted small" title="担当者・案件の担当者・マネージャー以上が変更できます">変更できません</span>}
                      </>
                    )}
                  </div>
                  <ProgressView task={t} compact />
                  {t.status !== 'done' && <LastReport task={t} />}
                </td>
                <td className="row-actions">
                  {t.can_edit && <button type="button" className="icon-btn" onClick={() => setEditing(t)} aria-label="変更"><Icon name="edit" size={16} /></button>}
                  {t.can_delete && <button type="button" className="icon-btn danger" onClick={() => setDeleting(t)} aria-label="削除"><Icon name="trash" size={16} /></button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {onPage && <Pagination page={Number(params.page ?? 1)} perPage={Number(params.per_page)} total={data.total} onChange={onPage} />}
      {editing && <TaskForm open task={editing} onClose={() => setEditing(null)} />}
      {reporting && <ReportDialog task={reporting} onClose={() => setReporting(null)} />}
      <ConfirmDialog open={!!deleting} title="タスクを削除" danger confirmLabel="削除する" busy={del.isPending}
        message={<>「{deleting?.title}」を削除します。</>} onConfirm={() => deleting && del.mutate(deleting)} onClose={() => setDeleting(null)} />
    </>
  )
}

export function Tasks() {
  const [f, setF] = useFilters({ q: '', status: 'open', mine: '', assignee_id: '', overdue: '', at_risk: '', stale: '', sort: 'due_date', page: '1' })
  const [adding, setAdding] = useState(false)
  const { data: users = [] } = useUserOptions()
  const statuses = f.status === 'open' ? ['todo', 'doing'] : f.status ? [f.status] : []
  const params = {
    q: f.q, status: statuses, mine: f.mine === '1', assignee_id: f.assignee_id, overdue: f.overdue === '1',
    at_risk: f.at_risk === '1', stale: f.stale === '1', sort: f.sort,
    page: Number(f.page), per_page: PER_PAGE,
  }
  return (
    <>
      <PageHeader title="タスク" description="案件ごとのやることです。進んだら「報告」で進み具合と見通しを知らせ、終わったら「完了にする」を押してください。"
        actions={<button type="button" className="btn btn-primary" onClick={() => setAdding(true)}><Icon name="plus" /> タスクを追加</button>} />
      <Card>
        <div className="chips">
          <button type="button" className={`chip ${f.mine === '1' ? 'on' : ''}`} onClick={() => setF({ mine: f.mine === '1' ? '' : '1', assignee_id: '' })}>自分のタスク</button>
          <button type="button" className={`chip chip-warn ${f.overdue === '1' ? 'on' : ''}`} onClick={() => setF({ overdue: f.overdue === '1' ? '' : '1' })}>期限切れだけ</button>
          <button type="button" className={`chip chip-warn ${f.at_risk === '1' ? 'on' : ''}`} onClick={() => setF({ at_risk: f.at_risk === '1' ? '' : '1' })}>遅れそうだけ</button>
          <button type="button" className={`chip ${f.stale === '1' ? 'on' : ''}`} onClick={() => setF({ stale: f.stale === '1' ? '' : '1' })}>止まっている（7 日報告なし）</button>
        </div>
        <div className="filters">
          <label className="search">
            <Icon name="search" />
            <input type="search" placeholder="やること・案件名・顧客名" value={f.q} onChange={(e) => setF({ q: e.target.value })} aria-label="検索" />
          </label>
          <select value={f.status} onChange={(e) => setF({ status: e.target.value })} aria-label="状態">
            <option value="open">未完了（未着手・対応中）</option>
            <option value="">すべて</option>
            {(Object.keys(TASK_STATUS) as TaskStatus[]).map((s) => <option key={s} value={s}>{TASK_STATUS[s]}</option>)}
          </select>
          <select value={f.assignee_id} onChange={(e) => setF({ assignee_id: e.target.value, mine: '' })} aria-label="担当者" disabled={f.mine === '1'}>
            <option value="">担当者：すべて</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <select value={f.sort} onChange={(e) => setF({ sort: e.target.value })} aria-label="並び順">
            <option value="due_date">期限が近い順</option>
            <option value="priority">優先度が高い順</option>
            <option value="updated_at">更新が新しい順</option>
          </select>
        </div>
        <TaskTable params={params} onPage={(p) => setF({ page: String(p) })} />
      </Card>
      {adding && <TaskForm open onClose={() => setAdding(false)} />}
    </>
  )
}
