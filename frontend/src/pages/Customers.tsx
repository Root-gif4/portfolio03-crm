import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Icon } from '../components/Icon'
import { Card, ConfirmDialog, Empty, ErrorBox, Loading, PageHeader, Pagination, ProjectBadge, useToast } from '../components/ui'
import { api } from '../lib/api'
import { date, dateTime, yen } from '../lib/format'
import { useFilters, useUserOptions } from '../lib/hooks'
import type { Customer, Page, Project } from '../lib/types'
import { CustomerForm, ProjectForm } from './forms'

const PER_PAGE = 20

export function Customers() {
  const [f, setF] = useFilters({ q: '', industry: '', owner_id: '', sort: 'name', page: '1' })
  const [adding, setAdding] = useState(false)
  const navigate = useNavigate()
  const { data: users = [] } = useUserOptions()
  const { data: industries = [] } = useQuery({ queryKey: ['customers', 'industries'], queryFn: () => api.get<string[]>('/api/customers/industries') })
  const { data, isLoading, error } = useQuery({
    queryKey: ['customers', f],
    queryFn: () => api.get<Page<Customer>>('/api/customers', { ...f, per_page: PER_PAGE }),
    placeholderData: (prev) => prev,
  })

  return (
    <>
      <PageHeader title="顧客" description="取引先の一覧です。会社名・フリガナ・電話番号などで探せます。"
        actions={<button type="button" className="btn btn-primary" onClick={() => setAdding(true)}><Icon name="plus" /> 顧客を追加</button>} />
      <Card>
        <div className="filters">
          <label className="search">
            <Icon name="search" />
            <input type="search" placeholder="会社名・フリガナ・電話・メール・住所" value={f.q} onChange={(e) => setF({ q: e.target.value })} aria-label="検索" />
          </label>
          <select value={f.industry} onChange={(e) => setF({ industry: e.target.value })} aria-label="業種">
            <option value="">業種：すべて</option>
            {industries.map((i) => <option key={i} value={i}>{i}</option>)}
          </select>
          <select value={f.owner_id} onChange={(e) => setF({ owner_id: e.target.value })} aria-label="担当者">
            <option value="">担当者：すべて</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <select value={f.sort} onChange={(e) => setF({ sort: e.target.value })} aria-label="並び順">
            <option value="name">フリガナ順</option>
            <option value="updated_at">更新が新しい順</option>
            <option value="open_amount">見込み金額が多い順</option>
            <option value="created_at">追加が新しい順</option>
          </select>
        </div>
        <ErrorBox error={error} />
        {isLoading ? <Loading /> : data && data.items.length === 0 ? (
          <Empty icon="customers" title="顧客が見つかりません">条件を変えるか、「顧客を追加」から登録してください。</Empty>
        ) : data && (
          <>
            <div className="table-wrap">
              <table className="table clickable">
                <thead><tr><th>会社名</th><th>業種</th><th>電話番号</th><th>担当者</th><th className="num">案件</th><th className="num">見込み金額</th><th>更新日</th></tr></thead>
                <tbody>
                  {data.items.map((c) => (
                    <tr key={c.id} onClick={() => navigate(`/customers/${c.id}`)}>
                      <td><Link to={`/customers/${c.id}`} onClick={(e) => e.stopPropagation()}><strong>{c.name}</strong></Link><br /><span className="muted small">{c.kana}</span></td>
                      <td>{c.industry || '—'}</td>
                      <td>{c.phone || '—'}</td>
                      <td>{c.owner.name}</td>
                      <td className="num">{c.project_count}</td>
                      <td className="num">{c.open_amount ? yen(c.open_amount) : '—'}</td>
                      <td>{date(c.updated_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={Number(f.page)} perPage={PER_PAGE} total={data.total} onChange={(p) => setF({ page: String(p) })} />
          </>
        )}
      </Card>
      {adding && <CustomerForm open onClose={() => setAdding(false)} onSaved={(c) => navigate(`/customers/${c.id}`)} />}
    </>
  )
}

export function CustomerDetail() {
  const id = Number(useParams().id)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const { data: c, isLoading, error } = useQuery({ queryKey: ['customer', id], queryFn: () => api.get<Customer>(`/api/customers/${id}`) })
  const { data: projects } = useQuery({
    queryKey: ['projects', { customer_id: id }],
    queryFn: () => api.get<Page<Project>>('/api/projects', { customer_id: id, per_page: 100 }),
  })
  const del = useMutation({
    mutationFn: () => api.del(`/api/customers/${id}`),
    onSuccess: () => {
      toast('success', '顧客を削除しました')
      void qc.invalidateQueries({ queryKey: ['customers'] })
      navigate('/customers')
    },
    onError: (e) => { setDeleting(false); toast('error', e.message) },
  })

  if (isLoading) return <Loading />
  if (error || !c) return <ErrorBox error={error ?? new Error('見つかりません')} />

  return (
    <>
      <Link to="/customers" className="back"><Icon name="back" size={16} /> 顧客の一覧へ</Link>
      <PageHeader title={c.name} description={[c.kana, c.industry].filter(Boolean).join('・')}
        actions={<>
          {c.can_edit && <button type="button" className="btn" onClick={() => setEditing(true)}><Icon name="edit" /> 変更</button>}
          {c.can_delete && <button type="button" className="btn btn-danger-outline" onClick={() => setDeleting(true)}><Icon name="trash" /> 削除</button>}
        </>} />
      <div className="grid-2 wide-left">
        <Card title={`案件（${projects?.total ?? 0}）`} actions={<button type="button" className="btn btn-sm btn-primary" onClick={() => setAdding(true)}><Icon name="plus" size={16} /> 案件を追加</button>}>
          {projects && projects.items.length ? (
            <div className="table-wrap">
              <table className="table clickable">
                <thead><tr><th>案件名</th><th>ステータス</th><th className="num">金額</th><th>受注予定日</th><th>担当</th></tr></thead>
                <tbody>
                  {projects.items.map((p) => (
                    <tr key={p.id} onClick={() => navigate(`/projects/${p.id}`)}>
                      <td><Link to={`/projects/${p.id}`} onClick={(e) => e.stopPropagation()}>{p.name}</Link></td>
                      <td><ProjectBadge status={p.status} /></td>
                      <td className="num">{yen(p.amount)}</td>
                      <td>{date(p.expected_close_date)}</td>
                      <td>{p.owner.name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty icon="projects" title="案件はまだありません" />}
        </Card>
        <Card title="基本情報">
          <dl className="dl">
            <dt>担当者</dt><dd>{c.owner.name}</dd>
            <dt>電話番号</dt><dd>{c.phone || '—'}</dd>
            <dt>メール</dt><dd>{c.email || '—'}</dd>
            <dt>住所</dt><dd>{c.address || '—'}</dd>
            <dt>見込み金額</dt><dd>{yen(c.open_amount)}</dd>
            <dt>メモ</dt><dd className="pre">{c.note || '—'}</dd>
            <dt>更新</dt><dd>{dateTime(c.updated_at)}</dd>
          </dl>
          {!c.can_edit && <p className="hint">この顧客を変更できるのは、担当者とマネージャー以上です。</p>}
        </Card>
      </div>
      {editing && <CustomerForm open customer={c} onClose={() => setEditing(false)} />}
      {adding && <ProjectForm open customerId={c.id} onClose={() => setAdding(false)} onSaved={(p) => navigate(`/projects/${p.id}`)} />}
      <ConfirmDialog open={deleting} title="顧客を削除" danger confirmLabel="削除する" busy={del.isPending}
        message={<>「{c.name}」を削除します。案件が残っている顧客は削除できません。削除した記録は操作履歴に残ります。</>}
        onConfirm={() => del.mutate()} onClose={() => setDeleting(false)} />
    </>
  )
}
