import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import Dashboard from './components/Dashboard';
import WorkerKiosk from './pages/WorkerKiosk';
import LoginPage from './components/LoginPage';

function App() {
  // undefined = 초기 로딩 중 / null = 비로그인 / Session = 로그인 완료
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    // 초기 세션 확인
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
    });

    // 로그인/로그아웃 이벤트 감지
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  // 초기 세션 확인 중 — 로딩 스피너
  if (session === undefined) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="text-gray-400 text-sm animate-pulse">로딩 중...</div>
      </div>
    );
  }

  // 비로그인 → 로그인 페이지
  if (!session) {
    return <LoginPage />;
  }

  // 로그인 완료 → 앱 본체
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/worker" element={<WorkerKiosk />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
