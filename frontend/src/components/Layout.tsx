import { useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router'
import { useAuth, useMe } from '../lib/auth'
import { ROLE } from '../lib/format'
import { useTheme } from '../lib/theme'
import { Icon } from './Icon'
import { DeadlineReminder } from './Reminder'

interface NavItem { to: string; label: string; icon: string; show?: boolean }

export function Layout() {
  const me = useMe()
  const { logout } = useAuth()
  const [theme, toggleTheme] = useTheme()
  const [open, setOpen] = useState(false)
  const location = useLocation()

  const groups: { title: string; items: NavItem[] }[] = [
    { title: '', items: [{ to: '/', label: 'ダッシュボード', icon: 'dashboard' }] },
    {
      title: '営業',
      items: [
        { to: '/customers', label: '顧客', icon: 'customers' },
        { to: '/projects', label: '案件', icon: 'projects' },
        { to: '/tasks', label: 'タスク', icon: 'tasks' },
        { to: '/schedule', label: '予定表', icon: 'calendar' },
      ],
    },
    {
      title: '管理',
      items: [
        { to: '/users', label: 'ユーザー', icon: 'users', show: me.can_manage_users },
        { to: '/team', label: 'チームの状況', icon: 'team', show: !!me.can_view_team },
        { to: '/audit', label: '操作履歴', icon: 'audit', show: me.can_view_audit },
        { to: '/settings', label: '設定', icon: 'settings' },
      ],
    },
  ]

  return (
    <div className={`shell ${open ? 'nav-open' : ''}`}>
      <aside className="sidebar" aria-label="メニュー">
        <div className="brand">
          <img src="/favicon.svg" alt="" width={30} height={30} />
          <div>
            <strong>顧客・案件管理</strong>
            <span>CRM</span>
          </div>
        </div>
        <nav>
          {groups.map((g) => {
            const items = g.items.filter((i) => i.show !== false)
            if (!items.length) return null
            return (
              <div key={g.title || 'top'} className="nav-group">
                {g.title && <p className="nav-title">{g.title}</p>}
                {items.map((i) => (
                  <NavLink key={i.to} to={i.to} end={i.to === '/'} onClick={() => setOpen(false)}
                    className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                    <Icon name={i.icon} /> {i.label}
                  </NavLink>
                ))}
              </div>
            )
          })}
        </nav>
        <div className="sidebar-foot">
          <button type="button" className="nav-link" onClick={toggleTheme}>
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} /> {theme === 'dark' ? 'ライトモード' : 'ダークモード'}
          </button>
          <div className="me">
            <div className="avatar" aria-hidden="true">{me.name.slice(0, 1)}</div>
            <div>
              <strong>{me.name}</strong>
              <span>{ROLE[me.role]}</span>
            </div>
          </div>
          <button type="button" className="nav-link" onClick={() => void logout()}>
            <Icon name="logout" /> ログアウト
          </button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button type="button" className="icon-btn menu-btn" onClick={() => setOpen(!open)} aria-label="メニューを開く">
            <Icon name="menu" />
          </button>
          <span className="topbar-title">顧客・案件管理</span>
        </header>
        <main key={location.pathname} className="content">
          <Outlet />
        </main>
      </div>
      {open && <div className="nav-backdrop" onClick={() => setOpen(false)} />}
      <DeadlineReminder />
    </div>
  )
}
