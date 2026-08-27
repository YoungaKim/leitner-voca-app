// 2a. Supabase 클라이언트 — Auth(구글 로그인) + Postgres 동기화 대상 접근.
// 키가 없으면(로컬 개발 초기 단계) null을 반환해서, 로그인 버튼을 숨기고 로컬 전용 모드로 계속 동작하게 한다.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase: SupabaseClient | null =
  url && anonKey ? createClient(url, anonKey) : null;

export const isCloudEnabled = supabase !== null;
