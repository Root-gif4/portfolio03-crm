import { useQuery } from '@tanstack/react-query'
import type { CSSProperties } from 'react'
import { Link } from 'react-router'
import { Icon } from '../components/Icon'
import { Card, Empty, ErrorBox, Loading, PageHeader, ProjectBadge } from '../components/ui'
import { api } from '../lib/api'
import { addDays, addMonths, daysFrom, PROJECT_STATUS, shortDate, TASK_STATUS, todayJst, weekday } from '../lib/format'
import { useFilters, useUserOptions } from '../lib/hooks'
import type { Schedule as S, ScheduleProject, ScheduleTask } from '../lib/types'

const thisMonth = () => `${todayJst().slice(0, 7)}-01`
const monthLabel = (s: string) => `${s.slice(0, 4)}年${Number(s.slice(5, 7))}月`

/** 予定表：案件とタスクを「開始日 → 期限（受注予定日）」の帯で並べる（ガントチャート） */
export function Schedule() {
  const [f, setF] = useFilters({ from: thisMonth(), span: '1', who: '', closed: '', tasks: '1' })
  const { data: users = [] } = useUserOptions()
  const span = f.span === '3' ? 3 : 1
  const start = /^\d{4}-\d{2}-01$/.test(f.from) ? f.from : thisMonth()
  const end = addDays(addMonths(start, span), -1)
  const { data, isLoading, error } = useQuery({
    queryKey: ['schedule', start, end, f.who, f.closed],
    queryFn: () => api.get<S>('/api/schedule', {
      start, end, mine: f.who === 'mine', owner_id: f.who && f.who !== 'mine' ? f.who : '', include_closed: f.closed === '1',
    }),
    placeholderData: (prev) => prev,
  })

  return (
    <>
      <PageHeader title="予定表" description="どの案件・タスクを、いつからいつまでに進めるかを帯で表示します。帯を押すと案件のページが開きます。" />
      <Card>
        <div className="filters schedule-filters">
          <div className="segmented" role="group" aria-label="月の移動">
            <button type="button" onClick={() => setF({ from: addMonths(start, -span) })} aria-label="前へ"><Icon name="prev" size={16} /></button>
            <button type="button" onClick={() => setF({ from: thisMonth() })}>今月</button>
            <button type="button" onClick={() => setF({ from: addMonths(start, span) })} aria-label="次へ"><Icon name="next" size={16} /></button>
          </div>
          <strong className="range-label">{span === 1 ? monthLabel(start) : `${monthLabel(start)} 〜 ${monthLabel(end)}`}</strong>
          <div className="segmented" role="group" aria-label="表示する長さ">
            <button type="button" className={span === 1 ? 'on' : ''} onClick={() => setF({ span: '1' })}>1 か月</button>
            <button type="button" className={span === 3 ? 'on' : ''} onClick={() => setF({ span: '3' })}>3 か月</button>
          </div>
          <select value={f.who} onChange={(e) => setF({ who: e.target.value })} aria-label="担当者">
            <option value="">担当者：すべて</option>
            <option value="mine">自分の（担当の案件・自分のタスク）</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <label className="check"><input type="checkbox" checked={f.tasks === '1'} onChange={(e) => setF({ tasks: e.target.checked ? '1' : '0' })} /> タスクも表示</label>
          <label className="check"><input type="checkbox" checked={f.closed === '1'} onChange={(e) => setF({ closed: e.target.checked ? '1' : '' })} /> 受注・失注も表示</label>
        </div>
        <Legend />
        <ErrorBox error={error} />
        {isLoading ? <Loading /> : data && (data.projects.length === 0 ? (
          <Empty icon="calendar" title="この期間の案件はありません">前後の月を見るか、担当者・表示の条件を変えてください。</Empty>
        ) : (
          <>
            <Gantt data={data} span={span} showTasks={f.tasks === '1'} />
            {data.truncated && <p className="hint">件数が多いため、最初の 200 件だけを表示しています。担当者で絞り込んでください。</p>}
          </>
        ))}
      </Card>
    </>
  )
}

function Legend() {
  return (
    <div className="gantt-legend muted small" aria-label="色の見方">
      <span>案件：</span>
      {(['lead', 'proposal', 'negotiation', 'won', 'lost'] as const).map((s) => <span key={s} className={`swatch g-swatch st-${s}`}>{PROJECT_STATUS[s]}</span>)}
      <span className="sep">タスク：</span>
      <span className="swatch g-task ts-todo">{TASK_STATUS.todo}</span>
      <span className="swatch g-task ts-doing">{TASK_STATUS.doing}</span>
      <span className="swatch g-task ts-done">{TASK_STATUS.done}</span>
      <span className="swatch g-task is-over">期限切れ</span>
      <span className="sep"><span className="today-mark" /> 今日</span>
    </div>
  )
}

function Gantt({ data, span, showTasks }: { data: S; span: number; showTasks: boolean }) {
  const n = daysFrom(data.start, data.end) + 1
  const days = Array.from({ length: n }, (_, i) => addDays(data.start, i))
  const pct = (d: string) => (Math.min(Math.max(daysFrom(data.start, d), 0), n) / n) * 100
  const todayIn = data.today >= data.start && data.today <= data.end
  const months = days.filter((d, i) => i === 0 || d.endsWith('-01'))
  const style = { '--days': n, minWidth: span === 1 ? 260 + n * 26 : 260 + n * 9 } as CSSProperties

  return (
    <div className="gantt-scroll">
      <div className={`gantt span-${span}`} style={style}>
        <div className="g-row g-header">
          <div className="g-label">案件 ／ タスク</div>
          <div className="g-track">
            <div className="g-months">
              {months.map((m) => <span key={m} style={{ left: `${pct(m)}%` }}>{monthLabel(m)}</span>)}
            </div>
            <div className="g-days">
              {days.map((d, i) => {
                const show = span === 1 || weekday(d) === 1
                return show ? (
                  <span key={d} style={{ left: `${(i / n) * 100}%`, width: span === 1 ? `${100 / n}%` : undefined }}
                    className={`${weekday(d) === 0 ? 'sun' : weekday(d) === 6 ? 'sat' : ''} ${d === data.today ? 'is-today' : ''}`}>
                    {span === 1 ? Number(d.slice(8)) : shortDate(d)}
                  </span>
                ) : null
              })}
            </div>
          </div>
        </div>

        <div className="g-body">
          {/* 土日の色（帯の下）と今日の線（帯の上） */}
          <div className="g-overlay" aria-hidden="true">
            {span === 1 && days.map((d, i) => weekday(d) % 6 === 0
              ? <span key={d} className="g-weekend" style={{ left: `${(i / n) * 100}%`, width: `${100 / n}%` }} /> : null)}
          </div>
          <div className="g-overlay top" aria-hidden="true">
            {todayIn && <span className="g-today" style={{ left: `${((daysFrom(data.start, data.today) + 0.5) / n) * 100}%` }} />}
          </div>
          {data.projects.map((p) => (
            <ProjectRows key={p.id} p={p} pct={pct} showTasks={showTasks} range={{ start: data.start, end: data.end }} />
          ))}
        </div>
      </div>
    </div>
  )
}

function Bar({ start, end, pct, className, label, title, to, range }: {
  start: string; end: string | null; pct: (d: string) => number; className: string; label: string; title: string; to: string
  range: Range
}) {
  const last = end ?? start
  // 表示している期間の外にあるときは、どちらにあるかだけを示す
  if (last < range.start) return <span className="g-out g-out-left">← {shortDate(last)} まで</span>
  if (start > range.end) return <span className="g-out g-out-right">{shortDate(start)} から →</span>
  const left = pct(start)
  const right = pct(addDays(last, 1))
  return (
    <Link to={to} className={`g-bar ${className} ${end ? '' : 'no-end'}`} title={title}
      style={{ left: `${left}%`, width: `max(${right - left}%, 6px)` }}>
      <span>{label}</span>
    </Link>
  )
}

type Range = { start: string; end: string }

function ProjectRows({ p, pct, showTasks, range }: { p: ScheduleProject; pct: (d: string) => number; showTasks: boolean; range: Range }) {
  const periodText = `${p.start_date} → ${p.expected_close_date ?? '受注予定日なし'}`
  return (
    <>
      <div className="g-row g-project">
        <div className="g-label">
          <Link to={`/projects/${p.id}`} className="g-name"><strong>{p.name}</strong></Link>
          <span className="muted small">{p.customer.name}・{p.owner.name}　<ProjectBadge status={p.status} /></span>
        </div>
        <div className="g-track">
          <Bar range={range} start={p.start_date} end={p.expected_close_date} pct={pct} className={`st-${p.status}`} to={`/projects/${p.id}`}
            label={`${shortDate(p.start_date)} → ${shortDate(p.expected_close_date)}`}
            title={`${p.name}（${PROJECT_STATUS[p.status]}）\n${periodText}`} />
        </div>
      </div>
      {showTasks && p.tasks.map((t) => <TaskRow key={t.id} t={t} projectId={p.id} pct={pct} range={range} />)}
    </>
  )
}

function TaskRow({ t, projectId, pct, range }: { t: ScheduleTask; projectId: number; pct: (d: string) => number; range: Range }) {
  const cls = t.overdue ? 'is-over' : `ts-${t.status}`
  return (
    <div className={`g-row g-taskrow ${t.status === 'done' ? 'is-done' : ''}`}>
      <div className="g-label">
        <span className="g-task-title">{t.title}</span>
        <span className="muted small">{t.assignee?.name ?? '（未定）'}・{t.overdue ? '期限切れ' : TASK_STATUS[t.status]}</span>
      </div>
      <div className="g-track">
        <Bar range={range} start={t.start_date} end={t.due_date} pct={pct} className={`g-task ${cls}`} to={`/projects/${projectId}`}
          label={t.title} title={`${t.title}（${t.overdue ? '期限切れ' : TASK_STATUS[t.status]}）\n${t.start_date} → ${t.due_date ?? '期限なし'}`} />
      </div>
    </div>
  )
}
