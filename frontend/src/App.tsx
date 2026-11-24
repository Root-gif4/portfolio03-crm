import { lazy, Suspense } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router'
import { Layout } from './components/Layout'
import { Empty, Loading } from './components/ui'
import { useAuth } from './lib/auth'
import { Audit, Settings, Users } from './pages/Admin'
import { CustomerDetail, Customers } from './pages/Customers'
import { Login } from './pages/Login'
import { ProjectDetail, Projects } from './pages/Projects'
import { Tasks } from './pages/Tasks'
import { Schedule } from './pages/Schedule'
import { Team } from './pages/Team'

// ダッシュボードはグラフの部品が大きいので、開いたときに読み込む
const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })))

function RequireLogin() {
  const { me, loading } = useAuth()
  if (loading) return <div className="center-page"><Loading /></div>
  if (!me) return <Navigate to="/login" replace />
  return <Layout />
}

function NotFound() {
  return <Empty title="ページが見つかりません"><Link to="/" className="link">ダッシュボードへ戻る</Link></Empty>
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<RequireLogin />}>
        <Route index element={<Suspense fallback={<Loading />}><Dashboard /></Suspense>} />
        <Route path="customers" element={<Customers />} />
        <Route path="customers/:id" element={<CustomerDetail />} />
        <Route path="projects" element={<Projects />} />
        <Route path="projects/:id" element={<ProjectDetail />} />
        <Route path="tasks" element={<Tasks />} />
        <Route path="schedule" element={<Schedule />} />
        <Route path="team" element={<Team />} />
        <Route path="users" element={<Users />} />
        <Route path="audit" element={<Audit />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  )
}
