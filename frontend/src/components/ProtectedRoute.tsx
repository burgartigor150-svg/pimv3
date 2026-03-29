import React from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { LogOut } from 'lucide-react';

export const ProtectedRoute: React.FC = () => {
  const { isAuthenticated, logout, user } = useAuth();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="flex flex-col h-full">
        {/* Optional slim top bar for logout */}
        <div className="absolute top-4 right-4 z-50">
             <button onClick={logout} className="flex items-center gap-2 bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border border-slate-700">
                  <LogOut className="w-4 h-4" />
                  Выйти
             </button>
        </div>
        <Outlet />
    </div>
  );
};
