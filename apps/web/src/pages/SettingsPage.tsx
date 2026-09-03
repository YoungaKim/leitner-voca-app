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
  const [aiKey, setAiKey] = useState(settings.aiApiKeys?.[settings.preferredAiModel] ?? "");
  const [aiKeySaved, setAiKeySaved] = useState(false);

  const AI_MODEL_LABELS: Record<"gemini" | "claude" | "gpt", string> = {
    gemini: "Gemini (무료)",
    claude: "Claude (유료)",
    gpt: "ChatGPT (유료)",
  };
  const AI_KEY_HELP: Record<
    "gemini" | "claude" | "gpt",
    { url: string; linkLabel: string; note: string }
  > = {
    gemini: {
      url: "https://aistudio.google.com/apikey",
      linkLabel: "aistudio.google.com/apikey 바로가기",
      note: "무료로 발급받아 입력하세요.",
    },
    claude: {
      url: "https://console.anthropic.com/settings/keys",
      linkLabel: "console.anthropic.com 바로가기",
      note: "발급에 결제수단 등록이 필요합니다. 비워두면 앱 공용 키를 씁니다.",
    },
    gpt: {
      url: "https://platform.openai.com/api-keys",
      linkLabel: "platform.openai.com 바로가기",
      note: "발급에 선불 크레딧이 필요합니다. 비워두면 앱 공용 키를 씁니다.",
    },
  };
  const aiKeyHelp = AI_KEY_HELP[settings.preferredAiModel];

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
    setAiKey(settings.aiApiKeys?.[model] ?? "");
    setAiKeySaved(false);
    setAiModelSaved(true);
    setTimeout(() => setAiModelSaved(false), 1500);
  }

  async function handleSaveAiKey(e: React.FormEvent) {
    e.preventDefault();
    const model = settings.preferredAiModel;
    await updateSettings({
      aiApiKeys: { ...settings.aiApiKeys, [model]: aiKey.trim() || undefined },
    });
    setAiKeySaved(true);
    setTimeout(() => setAiKeySaved(false), 1500);
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
        학습 세션의 [선생님한테 질문] 기능에 사용할 모델을 고르고, 그 모델의 API 키를 입력하세요. 키는 본인
        계정에만 저장되며(다른 기기에서도 공유), 질문할 때마다 서버 프록시를 거쳐 해당 API로 전달됩니다.
        키를 비워두면 앱 공용 키로 동작합니다.
      </p>
      <form className="card-form ai-form" onSubmit={handleSaveAiKey}>
        <label>
          모델
          <select
            value={settings.preferredAiModel}
            onChange={(e) => handleChangeAiModel(e.target.value as "claude" | "gemini" | "gpt")}
          >
            <option value="gemini">{AI_MODEL_LABELS.gemini}</option>
            <option value="claude">{AI_MODEL_LABELS.claude}</option>
            <option value="gpt">{AI_MODEL_LABELS.gpt}</option>
          </select>
        </label>
        {aiModelSaved && <p className="muted field-hint">모델 저장됨 ✓</p>}

        <label>
          {AI_MODEL_LABELS[settings.preferredAiModel]} API 키
          <input
            type="password"
            autoComplete="off"
            placeholder="API 키 입력 (비우면 앱 공용 키 사용)"
            value={aiKey}
            onChange={(e) => setAiKey(e.target.value)}
          />
        </label>
        <p className="muted field-hint">
          <a href={aiKeyHelp.url} target="_blank" rel="noreferrer">
            {aiKeyHelp.linkLabel} ↗
          </a>
          {" — "}
          {aiKeyHelp.note}
        </p>
        <button className="btn primary" type="submit">
          키 저장
        </button>
        {aiKeySaved && <p className="muted field-hint">저장됨 ✓</p>}
      </form>

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
