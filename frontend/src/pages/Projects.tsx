import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Icon } from '../components/Icon'
import { Card, ConfirmDialog, Empty, ErrorBox, Loading, PageHeader, Pagination, ProjectBadge, useToast } from '../components/ui'
import { api } from '../lib/api'
import { useMe } from '../lib/auth'
import { ACTION, date, dateTime, manYen, PROJECT_STATUS, PROJECT_STATUS_ORDER, sinceLabel, yen } from '../lib/format'
import { useFilters, useUserOptions } from '../lib/hooks'
import type { AuditLog, Page, Project, ProjectStatus } from '../lib/types'
import { ProjectForm, TaskForm } from './forms'
import { TaskTable } from './Tasks'

const PER_PAGE = 20

export function Projects() {
  const [f, setF] = useFilters({ q: '', status: '', owner_id: '', mine: '', sort: 'updated_at', view: 'list', page: '1' })
  const [adding, setAdding] = useState(false)
  const navigate = useNavigate()
  const { data: users = [] } = useUserOptions()
  const board = f.view === 'board'
  const { data, isLoading, error } = useQuery({
    queryKey: ['projects', f],
    queryFn: () => api.get<Page<Project>>('/api/projects', {
      q: f.q, status: f.status && f.status !== 'open' ? [f.status] : [], open_only: f.status === 'open', owner_id: f.owner_id, mine: f.mine === '1', sort: f.sort,
      page: board ? 1 : Number(f.page), per_page: board ? 100 : PER_PAGE,
    }),
    placeholderData: (prev) => prev,
  })

  return (
    <>
      <PageHeader title="案件" description="商談の一覧です。ステータスは 見込み → 提案中 → 交渉中 → 受注／失注 と進みます。"
        actions={<button type="button" className="btn btn-primary" onClick={() => setAdding(true)}><Icon name="plus" /> 案件を追加</button>} />
      <Card>
        <div className="chips" role="tablist" aria-label="ステータスで絞り込む">
          {(['', 'open', ...PROJECT_STATUS_ORDER] as (ProjectStatus | '' | 'open')[]).map((s) => (
            <button key={s || 'all'} type="button" role="tab" aria-selected={f.status === s}
              className={`chip ${f.status === s ? 'on' : ''} ${s ? `chip-${s}` : ''}`} onClick={() => setF({ status: s })}>
              {s === '' ? 'すべて' : s === 'open' ? '進行中（見込み〜交渉中）' : PROJECT_STATUS[s]}
            </button>
          ))}
        </div>
        <div className="filters">
          <label className="search">
            <Icon name="search" />
            <input type="search" placeholder="案件名・顧客名" value={f.q} onChange={(e) => setF({ q: e.target.value })} aria-label="検索" />
          </label>
          <select value={f.mine === '1' ? 'mine' : f.owner_id} onChange={(e) => e.target.value === 'mine' ? setF({ mine: '1', owner_id: '' }) : setF({ mine: '', owner_id: e.target.value })} aria-label="担当者">
            <option value="">担当者：すべて</option>
            <option value="mine">自分の案件</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <select value={f.sort} onChange={(e) => setF({ sort: e.target.value })} aria-label="並び順">
            <option value="updated_at">更新が新しい順</option>
            <option value="expected_close_date">受注予定日が近い順</option>
            <option value="start_date">開始日が新しい順</option>
            <option value="amount">金額が大きい順</option>
            <option value="name">案件名順</option>
          </select>
          <div className="segmented" role="group" aria-label="表示">
            <button type="button" className={!board ? 'on' : ''} onClick={() => setF({ view: 'list' })}>一覧</button>
            <button type="button" className={board ? 'on' : ''} onClick={() => setF({ view: 'board' })}>ボード</button>
          </div>
        </div>
        <ErrorBox error={error} />
        {isLoading ? <Loading /> : data && data.items.length === 0 ? (
          <Empty icon="projects" title="案件が見つかりません">条件を変えるか、「案件を追加」から登録してください。</Empty>
        ) : data && (board ? <Board projects={data.items} /> : (
          <>
            <div className="table-wrap">
              <table className="table clickable">
                <thead><tr><th>案件名</th><th>顧客</th><th>ステータス</th><th className="num">見込み金額</th><th>開始日</th><th>受注予定日</th><th>担当</th><th className="num">残りタスク</th></tr></thead>
                <tbody>
                  {data.items.map((p) => (
                    <tr key={p.id} onClick={() => navigate(`/projects/${p.id}`)}>
                      <td><Link to={`/projects/${p.id}`} onClick={(e) => e.stopPropagation()}><strong>{p.name}</strong></Link></td>
                      <td>{p.customer.name}</td>
                      <td><ProjectBadge status={p.status} /></td>
                      <td className="num">{yen(p.amount)}</td>
                      <td>{date(p.start_date)}</td>
                      <td>{date(p.expected_close_date)}</td>
                      <td>{p.owner.name}</td>
                      <td className="num">{p.task_open} / {p.task_total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={Number(f.page)} perPage={PER_PAGE} total={data.total} onChange={(p) => setF({ page: String(p) })} />
          </>
        ))}
      </Card>
      {adding && <ProjectForm open onClose={() => setAdding(false)} onSaved={(p) => navigate(`/projects/${p.id}`)} />}
    </>
  )
}

function Board({ projects }: { projects: Project[] }) {
  return (
    <div className="board">
      {PROJECT_STATUS_ORDER.map((s) => {
        const items = projects.filter((p) => p.status === s)
        const total = items.reduce((a, p) => a + p.amount, 0)
        return (
          <div key={s} className={`board-col col-${s}`}>
            <div className="board-head">
              <ProjectBadge status={s} />
              <span className="muted small">{items.length} 件・{manYen(total)}</span>
            </div>
            {items.map((p) => (
              <Link key={p.id} to={`/projects/${p.id}`} className="board-card">
                <strong>{p.name}</strong>
                <span className="muted small">{p.customer.name}</span>
                <span className="board-meta"><span>{yen(p.amount)}</span><span>{p.owner.name}</span></span>
              </Link>
            ))}
            {!items.length && <p className="muted small center">なし</p>}
          </div>
        )
      })}
    </div>
  )
}

export function ProjectDetail() {
  const id = Number(useParams().id)
  const me = useMe()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [addingTask, setAddingTask] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const { data: p, isLoading, error } = useQuery({ queryKey: ['project', id], queryFn: () => api.get<Project>(`/api/projects/${id}`) })
  const { data: history } = useQuery({
    queryKey: ['audit', 'project', id],
    queryFn: () => api.get<Page<AuditLog>>('/api/audit-logs', { entity_type: 'project', entity_id: id, per_page: 10 }),
    enabled: me.can_view_audit,
  })
  const del = useMutation({
    mutationFn: () => api.del(`/api/projects/${id}`),
    onSuccess: () => {
      toast('success', '案件を削除しました')
      void qc.invalidateQueries({ queryKey: ['projects'] })
      navigate('/projects')
    },
    onError: (e) => { setDeleting(false); toast('error', e.message) },
  })

  if (isLoading) return <Loading />
  if (error || !p) return <ErrorBox error={error ?? new Error('見つかりません')} />

  return (
    <>
      <Link to="/projects" className="back"><Icon name="back" size={16} /> 案件の一覧へ</Link>
      <PageHeader title={p.name} description={`顧客：${p.customer.name}`}
        actions={<>
          {p.can_edit && <button type="button" className="btn" onClick={() => setEditing(true)}><Icon name="edit" /> 変更</button>}
          {p.can_delete && <button type="button" className="btn btn-danger-outline" onClick={() => setDeleting(true)}><Icon name="trash" /> 削除</button>}
        </>} />

      <div className="steps" aria-label="ステータスの進み具合">
        {PROJECT_STATUS_ORDER.filter((s) => s !== 'lost' || p.status === 'lost').map((s) => {
          const idx = PROJECT_STATUS_ORDER.indexOf(s)
          const cur = PROJECT_STATUS_ORDER.indexOf(p.status)
          const state = s === p.status ? 'current' : p.status !== 'lost' && idx < cur ? 'done' : ''
          return <div key={s} className={`step ${state} step-${s}`}>{PROJECT_STATUS[s]}</div>
        })}
      </div>

      <div className="grid-2 wide-left">
        <Card title={`タスク（残り ${p.task_open} / ${p.task_total}）`} actions={<button type="button" className="btn btn-sm btn-primary" onClick={() => setAddingTask(true)}><Icon name="plus" size={16} /> タスクを追加</button>}>
          <TaskTable params={{ project_id: id, per_page: 100, sort: 'due_date' }} hideProject />
        </Card>
        <div className="stack">
          <Card title="案件の情報">
            <dl className="dl">
              <dt>ステータス</dt><dd><ProjectBadge status={p.status} /></dd>
              <dt>見込み金額</dt><dd className="big">{yen(p.amount)}</dd>
              <dt>開始日</dt><dd>{date(p.start_date)}{!p.closed_at && <span className="muted small">（{sinceLabel(p.start_date)}）</span>}</dd>
              <dt>受注予定日</dt><dd>{date(p.expected_close_date)}</dd>
              {p.closed_at && <><dt>{p.status === 'won' ? '受注日' : '失注日'}</dt><dd>{date(p.closed_at)}</dd></>}
              <dt>顧客</dt><dd><Link to={`/customers/${p.customer.id}`}>{p.customer.name}</Link></dd>
              <dt>担当者</dt><dd>{p.owner.name}</dd>
              <dt>内容</dt><dd className="pre">{p.description || '—'}</dd>
              <dt>更新</dt><dd>{dateTime(p.updated_at)}</dd>
            </dl>
            {!p.can_edit && <p className="hint">この案件を変更できるのは、担当者とマネージャー以上です。</p>}
          </Card>
          {me.can_view_audit && (
            <Card title="この案件の履歴">
              {history?.items.length ? (
                <ul className="timeline compact">
                  {history.items.map((h) => (
                    <li key={h.id}><span className={`dot act-${h.action}`} /><div><p>{h.summary}</p><p className="muted small">{dateTime(h.created_at)}・{h.user?.name ?? '—'}・{ACTION[h.action] ?? h.action}</p></div></li>
                  ))}
                </ul>
              ) : <p className="muted small">履歴はまだありません。</p>}
            </Card>
          )}
        </div>
      </div>
      {editing && <ProjectForm open project={p} onClose={() => setEditing(false)} />}
      {addingTask && <TaskForm open projectId={p.id} onClose={() => setAddingTask(false)} />}
      <ConfirmDialog open={deleting} title="案件を削除" danger confirmLabel="削除する" busy={del.isPending}
        message={<>「{p.name}」と、そのタスク {p.task_total} 件を削除します。削除した記録は操作履歴に残ります。</>}
        onConfirm={() => del.mutate()} onClose={() => setDeleting(false)} />
    </>
  )
}
