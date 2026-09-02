// 2d. 콘텐츠 자동 동기화 설정 — DESIGN §3.3~3.9.
// 시트 1개 = 덱 1개로 매핑(§3.4 스키마엔 덱 개념이 없어서 앱 쪽에서 대상 덱을 지정해줘야 함).
import { useState } from "react";
import { useAppStore } from "../store";

export default function SettingsPage() {
  const decks = useAppStore((s) => s.decks);
  const settings = useAppStore((s) => s.settings);
  const syncState = useAppStore((s) => s.syncState);
  const contentSyncing = useAppStore((s) => s.contentSyncing);
  const contentSyncErrors = useAppStore((s) => s.contentSyncErrors);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const syncContentNow = useAppStore((s) => s.syncContentNow);

  const [url, setUrl] = useState(settings.contentSourceUrl ?? "");
  const [deckId, setDeckId] = useState(settings.contentSourceDeckId ?? decks[0]?.id ?? "");

  const [dailyGoal, setDailyGoal] = useState(String(settings.dailyGoal));
  const [newCap, setNewCap] = useState(String(settings.newCap));
  const [maxActiveCards, setMaxActiveCards] = useState(String(settings.maxActiveCards));

  const [aiModelSaved, setAiModelSaved] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    await updateSettings({ contentSourceUrl: url.trim() || undefined, contentSourceDeckId: deckId || undefined });
  }

  async function handleToggleAutoSync(checked: boolean) {
    await updateSettings({ autoSyncEnabled: checked });
  }

  async function handleToggleTtsAutoPlay(checked: boolean) {
    await updateSettings({ ttsAutoPlay: checked });
  }

  async function handleSaveScheduler(e: React.FormEvent) {
    e.preventDefault();
    await updateSettings({
      dailyGoal: Math.max(1, Number(dailyGoal) || settings.dailyGoal),
      newCap: Math.max(0, Number(newCap) || settings.newCap),
      maxActiveCards: Math.max(1, Number(maxActiveCards) || settings.maxActiveCards),
    });
  }

  const canSync = Boolean(settings.contentSourceUrl && settings.contentSourceDeckId);

  async function handleChangeAiModel(model: "claude" | "gemini" | "gpt") {
    await updateSettings({ preferredAiModel: model });
    setAiModelSaved(true);
    setTimeout(() => setAiModelSaved(false), 1500);
  }

  return (
    <div className="page">
      <h2>설정</h2>

      <h3>학습량</h3>
      <p className="muted">
        하루 복습 목표(dailyGoal), 하루 신규 상한(newCap), 그리고 박스1~6에 동시에 쌓일 수 있는 카드
        총량(maxActiveCards)을 조절합니다. 오늘 기한이 된 복습은 상한 없이 전부 나오며, 목표는 완료 표시·
        진척도의 기준일 뿐 넘겨서 더 풀어도 됩니다. 복습 부하가 목표를 넘거나 maxActiveCards에 도달하면
        밀린 카드가 줄어들 때까지 신규 카드 유입이 자동으로 멈춥니다.
      </p>
      <form className="card-form" onSubmit={handleSaveScheduler}>
        <label className="field-row">
          하루 복습 목표(dailyGoal)
          <input type="number" min={1} value={dailyGoal} onChange={(e) => setDailyGoal(e.target.value)} />
        </label>
        <label className="field-row">
          하루 신규 상한(newCap)
          <input type="number" min={0} value={newCap} onChange={(e) => setNewCap(e.target.value)} />
        </label>
        <label className="field-row">
          학습 중 카드 총량 상한(maxActiveCards)
          <input
            type="number"
            min={1}
            value={maxActiveCards}
            onChange={(e) => setMaxActiveCards(e.target.value)}
          />
        </label>
        <button className="btn primary" type="submit">
          저장
        </button>
      </form>

      <h3>AI 선생님</h3>
      <p className="muted">
        학습 세션의 [선생님한테 질문] 기능에 사용할 모델을 선택하세요. API 키는 앱이 서버에서 관리하므로
        직접 입력할 필요는 없습니다.
      </p>
      <label className="field-row">
        모델
        <select
          value={settings.preferredAiModel}
          onChange={(e) => handleChangeAiModel(e.target.value as "claude" | "gemini" | "gpt")}
        >
          <option value="claude">Claude</option>
          <option value="gemini">Gemini</option>
          <option value="gpt">GPT</option>
        </select>
      </label>
      {aiModelSaved && <p className="muted">저장됨 ✓ (선택하면 즉시 저장돼요, 별도 저장 버튼 없음)</p>}

      <h3>발음(TTS)</h3>
      <p className="muted">
        브라우저 내장 음성 합성(Web Speech API)으로 정답 문장을 읽어줍니다. 별도 키·비용 없음(Chrome 기준).
      </p>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={settings.ttsAutoPlay}
          onChange={(e) => handleToggleTtsAutoPlay(e.target.checked)}
        />
        정답 확인 시 자동으로 발음 재생
      </label>

      <h3>콘텐츠 자동 동기화</h3>
      <p className="muted">
        구글시트 공유 링크(공유 → 일반 액세스 → 링크가 있는 모든 사용자로 설정)를 등록하면 새 문장을 자동으로
        저수지에 흡수합니다. 첫 번째 시트 탭의 열 구성: id · 한글 문장 · 영어 문장 · 청크·문법 메모(선택) ·
        level(선택) · topic(선택)
      </p>

      <form className="card-form" onSubmit={handleSave}>
        <input
          placeholder="구글시트 공유 링크 (예: https://docs.google.com/spreadsheets/d/…/edit)"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <select value={deckId} onChange={(e) => setDeckId(e.target.value)} disabled={decks.length === 0}>
          {decks.length === 0 && <option value="">단어장을 먼저 만들어주세요</option>}
          {decks.map((d) => (
            <option key={d.id} value={d.id}>
              대상 단어장: {d.name}
            </option>
          ))}
        </select>
        <button className="btn primary" type="submit" disabled={!url.trim() || !deckId}>
          저장
        </button>
      </form>

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={settings.autoSyncEnabled}
          onChange={(e) => handleToggleAutoSync(e.target.checked)}
        />
        앱 켤 때 하루 1회 자동 동기화
      </label>

      <div className="sync-status">
        <button className="btn secondary" onClick={() => syncContentNow()} disabled={!canSync || contentSyncing}>
          {contentSyncing ? "동기화 중…" : "지금 동기화"}
        </button>
        {syncState.lastSyncAt && (
          <p className="muted">
            마지막 동기화: {new Date(syncState.lastSyncAt).toLocaleString("ko-KR")} · {syncState.lastSyncResult}
          </p>
        )}
        {contentSyncErrors.length > 0 && (
          <ul className="sync-errors">
            {contentSyncErrors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
