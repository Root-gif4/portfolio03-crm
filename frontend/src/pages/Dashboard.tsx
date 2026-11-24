import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Icon } from '../components/Icon'
import { Card, Empty, ErrorBox, Loading, PageHeader, ProjectBadge } from '../components/ui'
import { api } from '../lib/api'
import { useMe } from '../lib/auth'
import { ACTION, date, dateTime, dueLabel, ENTITY, manYen, PROJECT_STATUS, yen } from '../lib/format'
import type { Dashboard as D, Task } from '../lib/types'

const STATUS_COLORS: Record<string, string> = { lead: '#94a3b8', proposal: '#60a5fa', negotiation: '#f59e0b', won: '#22c55e', lost: '#ef4444' }

/** 数字のカード。to があれば押せるカード（枠線・矢印・「一覧を見る」で見分けられる）、なければ表示だけ */
function Kpi({ icon, label, value, note, tone, to, linkLabel = '一覧を見る' }: {
  icon: string; label: string; value: string; note?: string; tone?: 'warn' | 'good'; to?: string; linkLabel?: string
}) {
  const body = (
    <>
      <div className="kpi-icon"><Icon name={icon} /></div>
      <div className="kpi-body">
        <p className="kpi-label">{label}</p>
        <p className="kpi-value">{value}</p>
        {note && <p className="kpi-note">{note}</p>}
      </div>
    </>
  )
  const cls = `kpi ${tone ? `kpi-${tone}` : ''}`
  if (!to) return <div className={`${cls} kpi-static`}>{body}</div>
  return (
    <Link to={to} className={`${cls} kpi-link`} aria-label={`${label} ${value}：${linkLabel}`}>
      {body}
      <span className="kpi-go">{linkLabel} <Icon name="arrow" size={14} /></span>
    </Link>
  )
}

function TaskList({ tasks, today, empty }: { tasks: Task[]; today: string; empty: string }) {
  if (!tasks.length) return <p className="muted small">{empty}</p>
  return (
    <ul className="list">
      {tasks.map((t) => (
        <li key={t.id}>
          <Link to={`/projects/${t.project.id}`} className="list-main">
            <strong>{t.title}</strong>
            <span className="muted small">{t.customer.name}／{t.project.name}</span>
          </Link>
          <span className={`due ${t.overdue ? 'due-over' : ''}`}>{dueLabel(t.due_date, today)}</span>
        </li>
      ))}
    </ul>
  )
}

export function Dashboard() {
  const me = useMe()
  const { data, isLoading, error } = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<D>('/api/dashboard') })
  const mineOnly = data?.kpi.overdue_scope === 'mine'

  return (
    <>
      <PageHeader title={`こんにちは、${me.name} さん`} description="今日の営業の様子です。期限の近いタスクと、締める予定の案件から確認しましょう。" />
      {isLoading && <Loading />}
      <ErrorBox error={error} />
      {data && (
        <>
          <p className="kpi-legend muted small"><span className="legend-link"><Icon name="arrow" size={12} /></span> 枠と矢印のあるカードは、押すと一覧が開きます。</p>
          <div className="kpi-grid">
            <Kpi icon="customers" label="顧客" value={`${data.kpi.customers} 社`} />
            <Kpi icon="projects" label="進行中の案件" value={`${data.kpi.open_projects} 件`} note="見込み・提案中・交渉中"
              to="/projects?status=open" />
            <Kpi icon="yen" label="見込み金額の合計" value={manYen(data.kpi.pipeline_amount)} note="進行中の案件"
              to="/projects?status=open&sort=amount" linkLabel="金額の大きい順に見る" />
            <Kpi icon="trend" label="今月の受注" value={manYen(data.kpi.won_this_month)} tone="good"
              note={data.kpi.win_rate === null ? '受注率 —' : `受注率 ${data.kpi.win_rate}%`} />
            <Kpi icon="alert" label={mineOnly ? 'あなたの期限切れタスク' : '期限切れのタスク'} value={`${data.kpi.overdue_tasks} 件`}
              tone={data.kpi.overdue_tasks ? 'warn' : undefined} note={mineOnly ? 'あなたが担当のもの' : 'チーム全体'}
              to={mineOnly ? '/tasks?overdue=1&mine=1' : '/tasks?overdue=1'} />
          </div>

          <div className="grid-2">
            <Card title="あなたのタスク" actions={<Link to="/tasks?mine=1" className="link">すべて見る</Link>}>
              <h3 className="sub danger"><Icon name="alert" size={16} /> 期限切れ（{data.my_overdue.length}）</h3>
              <TaskList tasks={data.my_overdue} today={data.today} empty="期限切れのタスクはありません。" />
              <h3 className="sub"><Icon name="clock" size={16} /> 7 日以内（{data.my_due_soon.length}）</h3>
              <TaskList tasks={data.my_due_soon} today={data.today} empty="7 日以内が期限のタスクはありません。" />
            </Card>
            <Card title="30 日以内に締める予定の案件" actions={<Link to="/projects?sort=expected_close_date" className="link">案件へ</Link>}>
              {data.closing_soon.length ? (
                <ul className="list">
                  {data.closing_soon.map((p) => (
                    <li key={p.id}>
                      <Link to={`/projects/${p.id}`} className="list-main">
                        <strong>{p.name}</strong>
                        <span className="muted small">{p.customer}　{date(p.expected_close_date)}（{dueLabel(p.expected_close_date, data.today).replace('まで', '')}）</span>
                      </Link>
                      <div className="right">
                        <ProjectBadge status={p.status} />
                        <span className="amount">{yen(p.amount)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : <Empty icon="projects" title="締める予定の案件はありません" />}
            </Card>
          </div>

          <div className="grid-2">
            <Card title="案件のステータス別（金額）">
              <div className="chart" aria-label="案件のステータス別の金額のグラフ">
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={data.by_status.map((s) => ({ ...s, label: `${PROJECT_STATUS[s.status]}（${s.count}件）` }))} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--grid)" />
                    <XAxis dataKey="label" tick={{ fill: 'var(--muted)', fontSize: 12 }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={manYen} tick={{ fill: 'var(--muted)', fontSize: 12 }} axisLine={false} tickLine={false} width={70} />
                    <Tooltip formatter={(v) => yen(Number(v))} cursor={{ fill: 'var(--hover)' }} contentStyle={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8 }} />
                    <Bar dataKey="amount" name="金額" radius={[6, 6, 0, 0]}>
                      {data.by_status.map((s) => <Cell key={s.status} fill={STATUS_COLORS[s.status]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card title="月別の受注金額（直近 6 か月）">
              <div className="chart" aria-label="月別の受注金額のグラフ">
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={data.monthly_won.map((m) => ({ ...m, label: `${Number(m.month.slice(5))}月` }))} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--grid)" />
                    <XAxis dataKey="label" tick={{ fill: 'var(--muted)', fontSize: 12 }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={manYen} tick={{ fill: 'var(--muted)', fontSize: 12 }} axisLine={false} tickLine={false} width={70} />
                    <Tooltip formatter={(v) => yen(Number(v))} cursor={{ fill: 'var(--hover)' }} contentStyle={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8 }} />
                    <Bar dataKey="amount" name="受注金額" fill="#22c55e" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          <Card title={me.can_view_audit ? '最近の動き' : 'あなたの最近の操作'} actions={me.can_view_audit && <Link to="/audit" className="link">操作履歴へ</Link>}>
            {data.recent.length ? (
              <ul className="timeline">
                {data.recent.map((r) => (
                  <li key={r.id}>
                    <span className={`dot act-${r.action}`} />
                    <div>
                      <p>{r.summary}</p>
                      <p className="muted small">{dateTime(r.created_at)}・{r.user || '—'}・{ENTITY[r.entity_type] ?? r.entity_type}の{ACTION[r.action] ?? r.action}</p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : <p className="muted small">まだ操作はありません。</p>}
          </Card>
        </>
      )}
    </>
  )
}
