import React, { useState } from 'react';
import { AdminDashboard } from './components/AdminDashboard';
import { TeacherDashboard } from './components/TeacherDashboard';
import { Shield, BookOpen } from 'lucide-react';

export function App() {
  const [currentView, setCurrentView] = useState<'admin' | 'teacher'>('admin');

  return (
    <div className="relative min-h-screen">
      {/* Quick switcher bar for Mohamed Wael during development & presentation */}
      <div className="fixed bottom-4 right-4 z-50 bg-[#17213B] text-white px-3 py-2 rounded-full shadow-2xl flex items-center gap-2 border border-[#48547B]/50 backdrop-blur-md">
        <span className="text-[11px] font-mono text-[#A8BDA6] px-2 hidden sm:inline">Mohamed Wael's Modules:</span>
        <button
          onClick={() => setCurrentView('admin')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition ${
            currentView === 'admin' ? 'bg-[#174E50] text-white' : 'text-[#7B8794] hover:text-white'
          }`}
        >
          <Shield className="w-3.5 h-3.5" />
          <span>Admin (W1)</span>
        </button>
        <button
          onClick={() => setCurrentView('teacher')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition ${
            currentView === 'teacher' ? 'bg-[#553B8F] text-white' : 'text-[#7B8794] hover:text-white'
          }`}
        >
          <BookOpen className="w-3.5 h-3.5" />
          <span>Teacher (W2)</span>
        </button>
      </div>

      {currentView === 'admin' ? (
        <AdminDashboard onSwitchToTeacher={() => setCurrentView('teacher')} />
      ) : (
        <TeacherDashboard onSwitchToAdmin={() => setCurrentView('admin')} />
      )}
    </div>
  );
}

export default App;
