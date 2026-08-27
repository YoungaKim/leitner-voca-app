import { useEffect, useRef } from "react";
import { NavLink, Route, Routes, useLocation } from "react-router-dom";
import HomePage from "./pages/HomePage";
import DecksPage from "./pages/DecksPage";
import DeckDetailPage from "./pages/DeckDetailPage";
import StudySessionPage from "./pages/StudySessionPage";
import SettingsPage from "./pages/SettingsPage";
import { useAppStore } from "./store";
import { initAuth, useAuthStore } from "./lib/auth";
import { isCloudEnabled } from "./lib/supabase";

export default function App() {
  const load = useAppStore((s) => s.load);
  const loaded = useAppStore((s) => s.loaded);
  const mergeFromCloud = useAppStore((s) => s.mergeFromCloud);
  const resetLocal = useAppStore((s) => s.resetLocal);
  const syncing = useAppStore((s) => s.syncing);
  const settings = useAppStore((s) => s.settings);
  const syncState = useAppStore((s) => s.syncState);
  const syncContentNow = useAppStore((s) => s.syncContentNow);
  const authReady = useAuthStore((s) => s.ready);
  const user = useAuthStore((s) => s.user);
  const signInWithGoogle = useAuthStore((s) => s.signInWithGoogle);
  const signOut = useAuthStore((s) => s.signOut);

  async function handleSignOut() {
    await signOut();
    await resetLocal();
  }
  const location = useLocation();
  const inSession = location.pathname.startsWith("/session");
  const authInited = useRef(false);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (authInited.current) return;
    authInited.current = true;
    initAuth((userId) => {
      mergeFromCloud(userId);
    });
  }, [mergeFromCloud]);

  // 2d §3.3: 앱 실행 시 하루 1회 자동 동기화(콘텐츠 소스 URL이 등록돼있고 자동 동기화가 켜져있으면).
  useEffect(() => {
    if (!loaded) return;
    if (!settings.autoSyncEnabled || !settings.contentSourceUrl || !settings.contentSourceDeckId) return;
    const lastSyncDate = syncState.lastSyncAt?.slice(0, 10);
    const todayDate = new Date().toISOString().slice(0, 10);
    if (lastSyncDate === todayDate) return;
    syncContentNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, settings.autoSyncEnabled, settings.contentSourceUrl, settings.contentSourceDeckId]);

  if (!loaded || !authReady) return <div className="page">불러오는 중...</div>;

  // 클라우드 연동이 켜진 배포에서는 로그인 전엔 로고+로그인 버튼만 보여준다(§2a 로그인 화면).
  // 클라우드가 아예 설정 안 됐으면(로컬 개발 초기 등) 기존처럼 로그인 없이 로컬 전용으로 계속 쓸 수 있다.
  if (isCloudEnabled && !user) {
    return (
      <div className="app-shell">
        <div className="page auth-gate">
          <h1 className="brand-logo">라이트너 문장 암기장</h1>
          <p className="muted">학습 기록은 구글 계정에 안전하게 저장됩니다.</p>
          <button className="btn primary large" onClick={() => signInWithGoogle()}>
            구글로 로그인
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      {!inSession && (
        <nav className="top-nav">
          <span className="brand">라이트너 문장 암기장</span>
          <NavLink to="/" end>
            홈
          </NavLink>
          <NavLink to="/decks">단어장</NavLink>
          <NavLink to="/settings">설정</NavLink>
          {/* isCloudEnabled && !user 인 경우는 위에서 로그인 게이트로 이미 걸러짐 — 여기 오면 항상 로그인된 상태. */}
          {isCloudEnabled && user && (
            <span className="auth-widget">
              {syncing && <span className="muted">동기화 중…</span>}
              <span className="muted">{user.email}</span>
              <button className="btn ghost" onClick={() => handleSignOut()}>
                로그아웃
              </button>
            </span>
          )}
        </nav>
      )}
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/decks" element={<DecksPage />} />
        <Route path="/decks/:deckId" element={<DeckDetailPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/session" element={<StudySessionPage />} />
      </Routes>
    </div>
  );
}
