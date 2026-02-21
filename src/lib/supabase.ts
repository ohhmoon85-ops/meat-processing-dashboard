import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

let supabase: SupabaseClient;

if (supabaseUrl && supabaseAnonKey) {
  supabase = createClient(supabaseUrl, supabaseAnonKey);
} else {
  console.warn(
    '[Supabase] VITE_SUPABASE_URL 또는 VITE_SUPABASE_ANON_KEY 환경변수가 설정되지 않았습니다. ' +
    '.env.local 파일을 확인하세요.'
  );
  // 더미 클라이언트 — 환경변수 미설정 시 auth/from 호출이 크래시하지 않도록 처리
  supabase = new Proxy({} as SupabaseClient, {
    get(_, prop) {
      if (prop === 'from') {
        return () => ({
          insert: async () => ({ error: new Error('Supabase가 설정되지 않았습니다. .env.local을 확인하세요.') }),
          select: async () => ({ data: [], error: new Error('Supabase가 설정되지 않았습니다.') }),
        });
      }
      if (prop === 'auth') {
        return {
          getSession:          async () => ({ data: { session: null }, error: null }),
          onAuthStateChange:   () => ({ data: { subscription: { unsubscribe: () => {} } } }),
          signInWithPassword:  async () => ({ data: { session: null }, error: new Error('Supabase가 설정되지 않았습니다.') }),
          signOut:             async () => ({ error: null }),
        };
      }
      return undefined;
    },
  });
}

export { supabase };
