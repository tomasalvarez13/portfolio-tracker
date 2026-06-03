import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar.jsx';
import BottomNav from './BottomNav.jsx';
import OnboardingModal from '../OnboardingModal.jsx';
import { useAuth } from '../../hooks/useAuth.jsx';

export default function Layout() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const key = user?.id ? `onboarding_v1_${user.id}` : null;
  const [showOnboarding, setShowOnboarding] = useState(
    () => key ? localStorage.getItem(key) !== 'done' : false
  );

  function handleDismiss(mode) {
    if (key) localStorage.setItem(key, 'done');
    setShowOnboarding(false);
    navigate('/app/posiciones');
  }

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

      {/* Onboarding: se muestra la primera vez que entra */}
      {showOnboarding && <OnboardingModal onDismiss={handleDismiss} />}
    </div>
  );
}
