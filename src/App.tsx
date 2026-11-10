import React, { useState } from 'react';
import { AdminDashboard } from './components/AdminDashboard';
import { TeacherDashboard } from './components/TeacherDashboard';
import ParentDashboard from './components/ParentDashboard';
import StudentCardsPrintPage from './components/StudentCardsPrintPage';
import { Shield, BookOpen, UserCheck, QrCode } from 'lucide-react';

export function App() {
  const [currentView, setCurrentView] = useState<'admin' | 'teacher' | 'parent' | 'qr'>('admin');

  return (
    <div className="relative min-h-screen">
      {/* Dynamic Module Switcher for Mohamed Wael & Team Presentation */}
      <div className="fixed bottom-4 right-4 z-50 bg-[#17213B] text-white px-3 py-2 rounded-full shadow-2xl flex items-center gap-1.5 border border-[#48547B]/50 backdrop-blur-md">
        <span className="text-[11px] font-mono text-[#A8BDA6] px-2 hidden md:inline">EduTrack Modules:</span>
        
        {/* Mohamed Wael Modules */}
        <button
          onClick={() => setCurrentView('admin')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition ${
            currentView === 'admin' ? 'bg-[#174E50] text-white shadow-xs' : 'text-[#7B8794] hover:text-white'
          }`}
          title="Mohamed Wael (Week 1)"
        >
          <Shield className="w-3.5 h-3.5" />
          <span>الأدمن (محمد وائل)</span>
        </button>

        <button
          onClick={() => setCurrentView('teacher')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition ${
            currentView === 'teacher' ? 'bg-[#553B8F] text-white shadow-xs' : 'text-[#7B8794] hover:text-white'
          }`}
          title="Mohamed Wael (Week 2)"
        >
          <BookOpen className="w-3.5 h-3.5" />
          <span>المعلم (محمد وائل)</span>
        </button>

        {/* Integrated Team Modules */}
        <button
          onClick={() => setCurrentView('parent')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition ${
            currentView === 'parent' ? 'bg-[#174E50] text-white shadow-xs' : 'text-[#7B8794] hover:text-white'
          }`}
          title="Youssef El-Qadi"
        >
          <UserCheck className="w-3.5 h-3.5" />
          <span>ولي الأمر (يوسف)</span>
        </button>

        <button
          onClick={() => setCurrentView('qr')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition ${
            currentView === 'qr' ? 'bg-[#4338CA] text-white shadow-xs' : 'text-[#7B8794] hover:text-white'
          }`}
          title="Abdelrahman Khodary"
        >
          <QrCode className="w-3.5 h-3.5" />
          <span>كروت QR (عبدالرحمن)</span>
        </button>
      </div>

      {/* Render Active View */}
      {currentView === 'admin' && (
        <AdminDashboard onSwitchToTeacher={() => setCurrentView('teacher')} />
      )}
      {currentView === 'teacher' && (
        <TeacherDashboard onSwitchToAdmin={() => setCurrentView('admin')} />
      )}
      {currentView === 'parent' && (
        <ParentDashboard />
      )}
      {currentView === 'qr' && (
        <StudentCardsPrintPage />
      )}
    </div>
  );
}

export default App;
