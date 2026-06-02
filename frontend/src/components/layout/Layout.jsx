import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar.jsx';
import BottomNav from './BottomNav.jsx';

export default function Layout() {
  return (
    <div className="h-screen flex overflow-hidden">
      {/* Sidebar: solo desktop */}
      <div className="hidden lg:block">
        <Sidebar />
      </div>

      {/* Contenido principal */}
      <main className="flex-1 min-w-0 overflow-y-auto pb-20 lg:pb-0">
        <div className="max-w-5xl mx-auto px-4 py-4 lg:px-8 lg:py-8">
          <Outlet />
        </div>
      </main>

      {/* Bottom nav: solo mobile */}
      <BottomNav />
    </div>
  );
}
