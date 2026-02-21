/**
 * 로그인 페이지
 *
 * - Supabase 이메일 + 비밀번호 인증 사용
 * - 관리자가 Supabase 대시보드에서 직접 계정을 추가해야 로그인 가능
 * - 자체 회원가입 불가 (계정 발급은 관리자 전용)
 */
import React, { useState } from 'react';
import { LogIn, Lock } from 'lucide-react';
import { supabase } from '../lib/supabase';

const LoginPage: React.FC = () => {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError('이메일 또는 비밀번호가 올바르지 않습니다.');
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-8">

        {/* 아이콘 + 제목 */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 bg-blue-600 rounded-full flex items-center justify-center shadow-lg">
              <Lock className="w-8 h-8 text-white" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-gray-800">육가공 행정 시스템</h1>
          <p className="text-gray-500 text-sm mt-1">승인된 계정으로만 접속할 수 있습니다.</p>
        </div>

        {/* 로그인 폼 */}
        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">이메일</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              placeholder="example@email.com"
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm
                focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">비밀번호</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="비밀번호 입력"
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm
                focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition"
            />
          </div>

          {/* 에러 메시지 */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2.5 rounded-lg">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-3 bg-blue-600 text-white
              rounded-lg font-semibold hover:bg-blue-700 transition-colors
              disabled:bg-gray-400 disabled:cursor-not-allowed mt-2"
          >
            <LogIn className="w-4 h-4" />
            {loading ? '로그인 중...' : '로그인'}
          </button>
        </form>

        <p className="text-center text-xs text-gray-400 mt-6">
          계정 발급은 관리자에게 문의하세요.
        </p>
      </div>
    </div>
  );
};

export default LoginPage;
