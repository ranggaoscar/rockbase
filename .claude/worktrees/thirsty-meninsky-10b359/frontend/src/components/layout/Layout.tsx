import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import Topbar from './Topbar'
import { useAppStore } from '@/store/useAppStore'
import { cn } from '@/lib/utils'

export default function Layout() {
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed)

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <Topbar />
      <main
        className={cn(
          'min-h-screen pt-14 transition-all duration-200',
          sidebarCollapsed ? 'ml-16' : 'ml-60'
        )}
      >
        <div className="p-6 animate-fade-in">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
