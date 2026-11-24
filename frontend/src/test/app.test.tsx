import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppRoutes } from '../App'
import { ToastProvider } from '../components/ui'
import { AuthProvider } from '../lib/auth'

const member = { id: 3, email: 'member1@example.com', name: '鈴木 美咲', role: 'member', active: true, last_login_at: null, can_manage_users: false, can_view_audit: false, can_delete: false }
const admin = { ...member, id: 1, name: '山田 花子', role: 'admin', can_manage_users: true, can_view_audit: true, can_delete: true }

function json(body: unknown, status = 200) {
  return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
}

/** API を真似る：URL ごとに返事を決める */
function mockApi(routes: Record<string, (url: string, init?: RequestInit) => Promise<Response>>) {
  const fn = vi.fn((url: string, init?: RequestInit) => {
    const path = url.split('?')[0]
    const handler = routes[path]
    return handler ? handler(url, init) : json({ message: '見つかりません。' }, 404)
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

function renderApp(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={[path]}>
            <AppRoutes />
          </MemoryRouter>
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>,
  )
}

const emptyPage = { items: [], total: 0, page: 1, per_page: 20 }

afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); localStorage.clear() })

describe('画面', () => {
  it('ログインしていなければログイン画面へ。失敗の理由を表示する', async () => {
    mockApi({
      '/api/auth/me': () => json({ message: 'ログインしてください。' }, 401),
      '/api/auth/login': () => json({ message: 'メールアドレスまたはパスワードが違います。' }, 401),
    })
    renderApp('/customers')
    expect(await screen.findByRole('button', { name: 'ログイン' })).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('メールアドレス'), 'a@example.com')
    await userEvent.type(screen.getByLabelText('パスワード'), 'wrong-pass-1')
    await userEvent.click(screen.getByRole('button', { name: 'ログイン' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('メールアドレスまたはパスワードが違います。')
  })

  it('ログインに成功すると、ログイン画面から離れる', async () => {
    let loggedIn = false
    mockApi({
      '/api/auth/me': () => (loggedIn ? json(member) : json({ message: '' }, 401)),
      '/api/auth/login': () => { loggedIn = true; return json(member) },
      '/api/customers': () => json(emptyPage),
      '/api/customers/industries': () => json([]),
      '/api/users/options': () => json([]),
    })
    renderApp('/login')
    await userEvent.type(await screen.findByLabelText('メールアドレス'), 'member1@example.com')
    await userEvent.type(screen.getByLabelText('パスワード'), 'demo-pass-2026')
    await userEvent.click(screen.getByRole('button', { name: 'ログイン' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'ログイン' })).not.toBeInTheDocument())
  })

  it('メンバーには「ユーザー」「操作履歴」のメニューを出さない', async () => {
    mockApi({
      '/api/auth/me': () => json(member),
      '/api/customers': () => json(emptyPage),
      '/api/customers/industries': () => json([]),
      '/api/users/options': () => json([]),
    })
    renderApp('/customers')
    expect(await screen.findByRole('heading', { name: '顧客' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /ユーザー/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /操作履歴/ })).not.toBeInTheDocument()
    expect(await screen.findByText('顧客が見つかりません')).toBeInTheDocument()
  })

  it('管理者にはメニューを出す', async () => {
    mockApi({
      '/api/auth/me': () => json(admin),
      '/api/users': () => json([admin]),
      '/api/users/options': () => json([]),
    })
    renderApp('/users')
    expect(await screen.findByRole('heading', { name: 'ユーザー' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /操作履歴/ })).toBeInTheDocument()
  })

  it('メンバーが /users を開いてもダッシュボードへ戻す', async () => {
    mockApi({ '/api/auth/me': () => json(member), '/api/dashboard': () => new Promise(() => undefined) })
    renderApp('/users')
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'ユーザー' })).not.toBeInTheDocument())
  })

  it('顧客の追加：入力の誤りは項目の下に出す', async () => {
    mockApi({
      '/api/auth/me': () => json(admin),
      '/api/customers': () => json({ message: 'メールアドレス：メールアドレスの形ではありません', field: 'email', errors: [{ field: 'email', message: 'メールアドレス：メールアドレスの形ではありません（例：taro@example.com）' }] }, 422),
      '/api/customers/industries': () => json([]),
      '/api/users/options': () => json([{ id: 1, name: '山田 花子' }]),
    })
    renderApp('/customers')
    await userEvent.click(await screen.findByRole('button', { name: /顧客を追加/ }))
    await userEvent.type(screen.getByLabelText(/会社名・屋号/), 'テスト')
    await userEvent.click(screen.getByRole('button', { name: '追加する' }))
    const alerts = await screen.findAllByRole('alert')
    expect(alerts.some((a) => a.textContent?.includes('メールアドレスの形ではありません'))).toBe(true)
  })
  it('ダッシュボード：押せるカードは一覧へのリンク。メンバーの期限切れは自分の分', async () => {
    mockApi({
      '/api/auth/me': () => json(member),
      '/api/tasks': () => json(emptyPage),
      '/api/dashboard': () => json({
        today: '2026-11-23',
        kpi: { customers: 15, open_projects: 17, pipeline_amount: 30_000_000, won_this_month: 1_000_000, win_rate: 60, overdue_tasks: 2, overdue_scope: 'mine' },
        by_status: [], monthly_won: [], my_overdue: [], my_due_soon: [], closing_soon: [], recent: [],
      }),
    })
    renderApp('/')
    const open = await screen.findByRole('link', { name: /進行中の案件 17 件/ })
    expect(open).toHaveAttribute('href', '/projects?status=open')
    expect(screen.getByRole('link', { name: /見込み金額の合計/ })).toHaveAttribute('href', '/projects?status=open&sort=amount')
    expect(screen.getByRole('link', { name: /あなたの期限切れタスク 2 件/ })).toHaveAttribute('href', '/tasks?overdue=1&mine=1')
    // 顧客数・今月の受注は表示だけ（リンクではない）
    expect(screen.queryByRole('link', { name: /顧客 15 社/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /今月の受注/ })).not.toBeInTheDocument()
  })

  it('タスク：「完了にする」で完了、完了したものは「元に戻す」', async () => {
    const task = {
      id: 7, title: '見積書の作成', status: 'todo', priority: 'medium', start_date: '2026-11-20', due_date: '2026-11-30',
      description: '', completed_at: null, project: { id: 1, name: '案件A' }, customer: { id: 1, name: '顧客A' },
      assignee: { id: 3, name: '鈴木 美咲' }, version: 1, created_at: '', updated_at: '', overdue: false, can_edit: true, can_delete: false,
    }
    let current = task
    const calls: { method?: string; body?: unknown }[] = []
    mockApi({
      '/api/auth/me': () => json(member),
      '/api/users/options': () => json([]),
      '/api/tasks': () => json({ ...emptyPage, items: [current], total: 1 }),
      '/api/tasks/7/status': (_u, init) => {
        const body = JSON.parse(String(init?.body))
        calls.push({ method: init?.method, body })
        current = { ...task, status: body.status, version: 2 }
        return json(current)
      },
    })
    renderApp('/tasks?status=')
    await userEvent.click(await screen.findByRole('button', { name: '「見積書の作成」を完了にする' }))
    await waitFor(() => expect(calls[0]).toEqual({ method: 'PATCH', body: { status: 'done', version: 1 } }))
    expect(await screen.findByRole('button', { name: '「見積書の作成」を未着手に戻す' })).toBeInTheDocument()
    expect(screen.getByText('11/20 → 11/30')).toBeInTheDocument()
  })

  it('ログインしたら、期限が近い自分のタスクをお知らせする（同じタブでは 1 回だけ）', async () => {
    const t = {
      id: 9, title: '契約書の確認', status: 'doing', priority: 'high', start_date: '2026-10-25', due_date: '2026-11-01',
      description: '', completed_at: null, project: { id: 2, name: '案件B' }, customer: { id: 2, name: '顧客B' },
      assignee: { id: 3, name: '鈴木 美咲' }, version: 1, created_at: '', updated_at: '', overdue: true, can_edit: true, can_delete: false,
    }
    localStorage.setItem('crm-reminder', JSON.stringify({ enabled: true, days: 3, sound: false }))
    const urls: string[] = []
    mockApi({
      '/api/auth/me': () => json(member),
      '/api/customers': () => json(emptyPage),
      '/api/customers/industries': () => json([]),
      '/api/users/options': () => json([]),
      '/api/tasks': (url) => { urls.push(url); return json({ ...emptyPage, items: [t], total: 1 }) },
    })
    const first = renderApp('/customers')
    const dialog = await screen.findByRole('dialog', { name: '期限のお知らせ' })
    expect(dialog).toHaveTextContent('契約書の確認')
    expect(dialog).toHaveTextContent('期限切れ（1）')
    expect(urls[0]).toContain('mine=true')
    expect(urls[0]).toContain('due_to=')
    await userEvent.click(screen.getByRole('button', { name: '確認しました' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    first.unmount()
    renderApp('/customers')
    expect(await screen.findByRole('heading', { name: '顧客' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: '期限のお知らせ' })).not.toBeInTheDocument()
  })

  it('予定表：案件とタスクを帯で出す', async () => {
    mockApi({
      '/api/auth/me': () => json(member),
      '/api/tasks': () => json(emptyPage),
      '/api/users/options': () => json([]),
      '/api/schedule': () => json({
        start: '2026-11-01', end: '2026-11-30', today: '2026-11-23', truncated: false,
        projects: [{
          id: 1, name: '業務システム導入', status: 'proposal', amount: 1, customer: { id: 1, name: '顧客A' }, owner: { id: 3, name: '鈴木 美咲' },
          start_date: '2026-10-20', expected_close_date: '2026-12-10',
          tasks: [{ id: 5, title: 'デモの準備', status: 'doing', priority: 'medium', start_date: '2026-11-18', due_date: '2026-11-25', assignee: null, overdue: false }],
        }],
      }),
    })
    renderApp('/schedule?from=2026-11-01')
    expect(await screen.findByRole('heading', { name: '予定表' })).toBeInTheDocument()
    expect(await screen.findByText('2026年11月', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '業務システム導入' })).toHaveAttribute('href', '/projects/1')
    const bar = screen.getByTitle(/デモの準備（対応中）/)
    expect(bar).toHaveAttribute('href', '/projects/1')
    expect(bar.getAttribute('style')).toContain('left: 56.66')
  })
  it('タスク：「報告」で進み具合・見通し・ひとことを送る', async () => {
    const task = {
      id: 7, title: '見積書の作成', status: 'doing', priority: 'medium', start_date: '2026-11-20', due_date: '2026-11-30',
      description: '', completed_at: null, project: { id: 1, name: '案件A' }, customer: { id: 1, name: '顧客A' },
      assignee: { id: 3, name: '鈴木 美咲' }, version: 3, created_at: '', updated_at: '', overdue: false,
      progress: 20, outlook: null, report_note: '', reported_at: null, can_edit: true, can_delete: false,
    }
    const sent: unknown[] = []
    mockApi({
      '/api/auth/me': () => json(member),
      '/api/users/options': () => json([]),
      '/api/tasks': () => json({ ...emptyPage, items: [task], total: 1 }),
      '/api/tasks/7/report': (_u, init) => {
        const body = JSON.parse(String(init?.body))
        sent.push(body)
        return json({ ...task, ...body, report_note: body.note, reported_at: '2026-11-23T10:00:00+09:00', version: 4 })
      },
    })
    renderApp('/tasks')
    expect(await screen.findByText('まだ報告がありません')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: '進み具合 20%' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '「見積書の作成」の進み具合を報告' }))
    const dialog = await screen.findByRole('dialog', { name: '進み具合を報告' })
    await userEvent.click(screen.getByRole('button', { name: '50%' }))
    await userEvent.click(screen.getByLabelText(/遅れそう/))
    await userEvent.type(screen.getByLabelText('ひとこと（任意）'), '先方の返事待ち')
    await userEvent.click(screen.getByRole('button', { name: '報告する' }))
    await waitFor(() => expect(sent[0]).toEqual({ progress: 50, outlook: 'at_risk', note: '先方の返事待ち', version: 3 }))
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
  })

  it('期限のお知らせで「遅れそう」を押すと見通しを送る', async () => {
    const t = {
      id: 9, title: '契約書の確認', status: 'doing', priority: 'medium', start_date: '2026-10-25', due_date: '2026-11-01',
      description: '', completed_at: null, project: { id: 2, name: '案件B' }, customer: { id: 2, name: '顧客B' },
      assignee: { id: 3, name: '鈴木 美咲' }, version: 5, created_at: '', updated_at: '', overdue: true,
      progress: 40, outlook: null, report_note: '', reported_at: null, can_edit: true, can_delete: false,
    }
    localStorage.setItem('crm-reminder', JSON.stringify({ enabled: true, days: 3, sound: false }))
    const sent: unknown[] = []
    mockApi({
      '/api/auth/me': () => json(member),
      '/api/customers': () => json(emptyPage),
      '/api/customers/industries': () => json([]),
      '/api/users/options': () => json([]),
      '/api/tasks': () => json({ ...emptyPage, items: [t], total: 1 }),
      '/api/tasks/9/report': (_u, init) => {
        const body = JSON.parse(String(init?.body))
        sent.push(body)
        return json({ ...t, outlook: body.outlook, version: 6, reported_at: '2026-11-23T10:00:00+09:00' })
      },
    })
    renderApp('/customers')
    await screen.findByRole('dialog', { name: '期限のお知らせ' })
    await userEvent.click(screen.getByRole('button', { name: '遅れそう' }))
    await waitFor(() => expect(sent[0]).toEqual({ outlook: 'at_risk', note: '', version: 5 }))
    // 押したあとも開いたまま（読み直しても閉じたり鳴り直したりしない）
    expect(await screen.findByText('⚠ 遅れそう')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: '期限のお知らせ' })).toBeInTheDocument()
  })

  it('チームの状況：管理者にはメニューと表を出し、メンバーには出さない', async () => {
    const team = {
      today: '2026-11-23', stale_days: 7,
      members: [
        { id: 3, name: '鈴木 美咲', role: 'member', role_label: 'メンバー', open: 4, doing: 2, overdue: 1, due_week: 2, at_risk: 1, stale: 0, avg_progress: 35, last_report_at: '2026-11-22T18:00:00+09:00' },
        { id: null, name: '（担当者なし）', role: '', role_label: '', open: 1, doing: 0, overdue: 0, due_week: 0, at_risk: 0, stale: 1, avg_progress: 0, last_report_at: null },
      ],
      at_risk: [{
        id: 9, title: '契約書の確認', status: 'doing', priority: 'medium', start_date: '2026-11-10', due_date: '2026-11-25', description: '',
        completed_at: null, project: { id: 2, name: '案件B' }, customer: { id: 2, name: '顧客B' }, assignee: { id: 3, name: '鈴木 美咲' },
        version: 1, created_at: '', updated_at: '', overdue: false, progress: 30, outlook: 'at_risk', report_note: '先方待ち',
        reported_at: '2026-11-22T18:00:00+09:00', can_edit: true, can_delete: true,
      }],
      overdue: [], stale: [],
    }
    mockApi({ '/api/auth/me': () => json({ ...admin, can_view_team: true }), '/api/tasks': () => json(emptyPage), '/api/team/status': () => json(team) })
    renderApp('/team')
    expect(await screen.findByRole('heading', { name: 'チームの状況' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /チームの状況/ })).toBeInTheDocument()
    expect(await screen.findByText('鈴木 美咲', { selector: 'strong' })).toBeInTheDocument()
    const links = screen.getAllByRole('link').map((a) => a.getAttribute('href'))
    expect(links).toContain('/tasks?assignee_id=3&overdue=1')
    expect(links).toContain('/tasks?assignee_id=3&at_risk=1')
    expect(links).toContain('/tasks?stale=1')
    expect(screen.getByText('「先方待ち」', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('期限切れのタスクはありません。')).toBeInTheDocument()
  })

  it('メンバーが /team を開いてもダッシュボードへ戻し、メニューにも出さない', async () => {
    mockApi({ '/api/auth/me': () => json(member), '/api/tasks': () => json(emptyPage), '/api/dashboard': () => new Promise(() => undefined) })
    renderApp('/team')
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'チームの状況' })).not.toBeInTheDocument())
    expect(screen.queryByRole('link', { name: /チームの状況/ })).not.toBeInTheDocument()
  })
})
