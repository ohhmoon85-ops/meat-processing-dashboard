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
  // 더미 클라이언트 — 호출 시 명확한 에러를 던지도록 Proxy 사용
  supabase = new Proxy({} as SupabaseClient, {
    get(_, prop) {
      if (prop === 'from') {
        return () => ({
          insert: async () => ({ error: new Error('Supabase가 설정되지 않았습니다. .env.local을 확인하세요.') }),
          select: async () => ({ data: [], error: new Error('Supabase가 설정되지 않았습니다.') }),
        });
      }
      return undefined;
    },
  });
}

export { supabase };
