"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import VideoPreview from "@/components/VideoPreview";
import {
  END_SESSION_MAX_LINES,
  RECENT_LINES_KEEP,
  TTS_VOICES,
} from "@/lib/config";
import { type SendPayload, useAutoNarration } from "@/hooks/useAutoNarration";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { useTts } from "@/hooks/useTts";

/**
 * 録画モード（ticket 11）の文字サイズ段階。OBSに映す前提で大きめに。
 * tempo/cost 系ではないUI定数なので config.ts ではなくここで一元管理する。
 */
const RECORDING_FONT_STEPS = [
  "text-3xl",
  "text-4xl",
  "text-5xl",
  "text-6xl",
  "text-7xl",
] as const;
const DEFAULT_FONT_IDX = 2; // text-5xl

/**
 * セッション画面の対話本体（ticket 10）。03/04/07/08 を1つに配線する。
 *
 * - 04（自動/手動トリガー）が現フレームを取り、`onSend` で 07 をストリーム fetch。
 * - 受信チャンクを画面に逐次表示しつつ 08（`useTts`）へ流して文単位に読み上げる。
 * - 直近の AI 発言を保持し、繰り返し防止用に次の送信へ渡す。
 * - 録画モード（ticket 11）: AI発言だけを全画面・単色背景で大きく表示する。
 */
export default function SessionClient({
  playthroughId,
  initialChapter,
}: {
  playthroughId: string;
  initialChapter: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // VideoPreview は親が安定参照を渡す前提。インライン関数だとストリーミング中の
  // チャンク毎の再レンダーで callback ref が作り直され、<video> の ref が
  // 付け外しされ続けるため useCallback で固定する。
  const handleVideoElement = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
  }, []);
  // 今回のセッションの全 AI 発言を保持（表示用 recentLines とは別・end-session 用）。
  const sessionLinesRef = useRef<string[]>([]);

  const tts = useTts();
  // onSend↔auto の循環を避けるため、auto 由来の値と tts は ref 経由で参照する
  // （capture-test と同手法）。毎レンダーで最新に更新する。
  const ttsRef = useRef(tts);
  ttsRef.current = tts;
  const addRecentRef = useRef<(line: string) => void>(() => {});

  const [currentText, setCurrentText] = useState("");
  const [recentLines, setRecentLines] = useState<string[]>([]);

  // 録画モード（ticket 11）: 表示切替のみ。自動実況・読み上げのループは止めない。
  const [recording, setRecording] = useState(false);
  const [fontIdx, setFontIdx] = useState(DEFAULT_FONT_IDX);
  const lastFontIdx = RECORDING_FONT_STEPS.length - 1;

  // 録画モード中は Esc で通常画面に戻れるようにする。
  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setRecording(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [recording]);

  // セッション終了・保存（ticket 12・任意の継続性）。
  const [chapterInput, setChapterInput] = useState(initialChapter);
  const [saving, setSaving] = useState(false);
  const [savedSummary, setSavedSummary] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const endSession = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    setSavedSummary(null);
    try {
      const res = await fetch("/api/end-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playthroughId,
          lines: sessionLinesRef.current.slice(-END_SESSION_MAX_LINES),
          chapter: chapterInput.trim() || undefined,
        }),
      });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        state?: { last_session_summary?: string };
        error?: string;
      } | null;
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error ?? `保存に失敗(HTTP ${res.status})`);
      }
      setSavedSummary(data.state?.last_session_summary ?? "（要約なし）");
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [playthroughId, chapterInput]);

  // 1回の実況送信：07 をストリーム fetch → 逐次表示＋逐次読み上げ。
  const onSend = useCallback(
    async ({ imageBase64, recentLines, userMessage, isIdle }: SendPayload) => {
      ttsRef.current.reset(); // 新しい発言。前の再生/バッファを破棄。
      setCurrentText("");

      const res = await fetch("/api/narrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playthroughId,
          imageBase64,
          recentLines,
          userMessage: userMessage?.trim() || undefined,
          isIdle,
        }),
      });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error ?? `実況の取得に失敗(HTTP ${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let full = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        full += chunk;
        setCurrentText(full);
        ttsRef.current.feed(chunk); // 文末確定ごとに逐次読み上げ。
      }
      ttsRef.current.flush();

      const line = full.trim();
      if (line) {
        addRecentRef.current(line); // 繰り返し防止用に hook 内へ記録。
        setRecentLines((prev) => [line, ...prev].slice(0, RECENT_LINES_KEEP));
        sessionLinesRef.current.push(line); // end-session の要約用に全件保持。
      }
    },
    [playthroughId],
  );

  // 読み上げが鳴り終わるまで、自動ループの発話（実況・自発発話とも）を待たせる。
  // 撃つと onSend 冒頭の reset() で前の発言が途中で切れる。SLGは1手ごとに画面が
  // 動くので、実況側にこのガードが無いと台詞がほぼ毎回途中で切り落とされる。
  const canSpeak = useCallback(
    () => !ttsRef.current.speaking && ttsRef.current.queueLength === 0,
    [],
  );

  const auto = useAutoNarration({ videoRef, onSend, canSpeak });
  addRecentRef.current = auto.addRecentLine;

  // STT（音声で話しかける・ticket 13・任意）。認識テキストを手動トリガーに添えて送る。
  const [sttEnabled, setSttEnabled] = useState(false);
  const [lastUserMessage, setLastUserMessage] = useState("");
  const stt = useSpeechRecognition({
    onResult: (text) => {
      const t = text.trim();
      if (!t) return;
      setLastUserMessage(t);
      auto.triggerNow(t); // 手動トリガー経由で発話を添えて送信。
    },
  });

  return (
    <div className="flex flex-col gap-5">
      <VideoPreview onVideoElement={handleVideoElement} />

      {/* コントロール: 自動 ON/OFF・手動トリガー・読み上げ ON/OFF・ボイス選択 */}
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={auto.enabled}
            onChange={(e) => auto.setEnabled(e.target.checked)}
          />
          自動実況
        </label>

        <button
          type="button"
          className="rounded bg-foreground px-3 py-1 text-sm text-background disabled:opacity-50"
          onClick={() => auto.triggerNow()}
          disabled={auto.busy}
        >
          今の場面について話して
        </button>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={tts.enabled}
            onChange={(e) => tts.setEnabled(e.target.checked)}
          />
          読み上げ
        </label>

        <label className="flex items-center gap-2 text-sm">
          ボイス
          <select
            className="rounded border border-black/15 bg-background px-2 py-1 text-foreground dark:border-white/15"
            value={tts.voice}
            onChange={(e) => tts.setVoice(e.target.value)}
          >
            {TTS_VOICES.map((v) => (
              <option key={v} value={v} className="bg-background text-foreground">
                {v.replace("ja-JP-Chirp3-HD-", "")}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className="rounded border border-black/15 px-3 py-1 text-sm dark:border-white/15"
          onClick={() => setRecording(true)}
        >
          録画モード
        </button>

        {/* STT: 音声で話しかける（ticket 13・任意・ブラウザ依存） */}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={sttEnabled}
            disabled={!stt.supported}
            onChange={(e) => setSttEnabled(e.target.checked)}
          />
          音声で話しかける
        </label>
        {sttEnabled && stt.supported && (
          <button
            type="button"
            className="rounded bg-foreground px-3 py-1 text-sm text-background disabled:opacity-50"
            onClick={() => (stt.listening ? stt.stop() : stt.start())}
            disabled={auto.busy}
          >
            {stt.listening ? "聞き取り中…（停止）" : "🎤 話しかける"}
          </button>
        )}
      </div>

      {!stt.supported && (
        <p className="text-xs text-black/45 dark:text-white/45">
          このブラウザは音声認識（STT）に非対応です。Chrome 系でお試しください。
        </p>
      )}

      {/* STT: 暫定認識・直近の話しかけ・エラー */}
      {(stt.interim || lastUserMessage) && (
        <p className="text-sm text-black/60 dark:text-white/60">
          あなた: {stt.interim || lastUserMessage}
        </p>
      )}
      {stt.error && (
        <p className="rounded border border-amber-400/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          {stt.error}
        </p>
      )}

      {/* 現在の実況（ストリーミング） */}
      <section className="min-h-24 rounded border border-black/10 p-4 dark:border-white/10">
        {currentText ? (
          <p className="whitespace-pre-wrap text-lg leading-relaxed">
            {currentText}
          </p>
        ) : (
          <p className="text-sm text-black/45 dark:text-white/45">
            {auto.busy
              ? "考えています…"
              : "自動実況を ON にするか、ボタンで話しかけてください。"}
          </p>
        )}
      </section>

      {/* 補助ステータス */}
      <div className="flex flex-wrap gap-4 text-xs text-black/55 dark:text-white/55">
        <span>生成中: {auto.busy ? "はい" : "いいえ"}</span>
        <span>読み上げ中: {tts.speaking ? "はい" : "いいえ"}</span>
        <span>直近 diff: {auto.lastDiff.toFixed(4)}</span>
      </div>

      {/* エラー（送信/生成・読み上げ） */}
      {auto.lastError && (
        <p className="rounded border border-red-400/50 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
          実況エラー: {auto.lastError}
        </p>
      )}
      {tts.lastError && (
        <p className="rounded border border-amber-400/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
          読み上げエラー: {tts.lastError}（テキスト表示は継続します）
        </p>
      )}

      {/* 直近の発言（繰り返し防止に使う・確認用表示） */}
      {recentLines.length > 0 && (
        <section className="flex flex-col gap-1">
          <h2 className="text-sm font-medium text-black/60 dark:text-white/60">
            これまでの発言
          </h2>
          <ul className="flex flex-col gap-1 text-sm text-black/70 dark:text-white/70">
            {recentLines.map((line, i) => (
              <li key={i} className="border-l-2 border-black/10 pl-2 dark:border-white/10">
                {line}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* セッション終了・保存（任意の継続性・ticket 12） */}
      <section className="flex flex-col gap-2 border-t border-black/10 pt-4 dark:border-white/10">
        <h2 className="text-sm font-medium text-black/60 dark:text-white/60">
          セッションを終了して保存
        </h2>
        <p className="text-xs text-black/45 dark:text-white/45">
          今回の実況を要約して「前回までのあらすじ」に保存します（次回に反映）。到達章も更新できます。
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            到達章
            <input
              value={chapterInput}
              onChange={(e) => setChapterInput(e.target.value)}
              placeholder="例: 第2章"
              className="w-32 rounded border border-black/15 bg-background px-2 py-1 text-foreground dark:border-white/15"
            />
          </label>
          <button
            type="button"
            className="rounded bg-foreground px-3 py-1 text-sm text-background disabled:opacity-50"
            onClick={endSession}
            disabled={saving}
          >
            {saving ? "保存中…" : "セッション終了して保存"}
          </button>
        </div>
        {savedSummary && (
          <div className="rounded border border-green-500/40 bg-green-500/10 px-3 py-2 text-sm">
            <span className="text-green-700 dark:text-green-400">保存しました。</span>{" "}
            <span className="text-black/70 dark:text-white/70">{savedSummary}</span>
          </div>
        )}
        {saveError && (
          <p className="rounded border border-red-400/50 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
            保存エラー: {saveError}
          </p>
        )}
      </section>

      {/* 録画モード: AI発言だけを全画面・単色背景で大きく表示（他UIを覆う） */}
      {recording && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background text-foreground">
          <div className="flex items-center justify-end gap-2 p-3 text-sm">
            <button
              type="button"
              className="rounded bg-black/5 px-3 py-1 text-black/70 hover:bg-black/10 dark:bg-white/10 dark:text-white/80 dark:hover:bg-white/20"
              onClick={() => setFontIdx((i) => Math.max(0, i - 1))}
              aria-label="文字を小さく"
            >
              A-
            </button>
            <button
              type="button"
              className="rounded bg-black/5 px-3 py-1 text-black/70 hover:bg-black/10 dark:bg-white/10 dark:text-white/80 dark:hover:bg-white/20"
              onClick={() => setFontIdx((i) => Math.min(lastFontIdx, i + 1))}
              aria-label="文字を大きく"
            >
              A+
            </button>
            <button
              type="button"
              className="rounded bg-black/5 px-3 py-1 text-black/70 hover:bg-black/10 dark:bg-white/10 dark:text-white/80 dark:hover:bg-white/20"
              onClick={() => setRecording(false)}
            >
              終了（Esc）
            </button>
          </div>

          <div className="flex flex-1 items-center justify-center px-[6vw] pb-[6vh]">
            {currentText ? (
              <p
                className={`mx-auto max-w-[24ch] whitespace-pre-wrap text-center font-semibold leading-snug ${RECORDING_FONT_STEPS[fontIdx]}`}
              >
                {currentText}
              </p>
            ) : (
              <p className="text-center text-xl text-black/35 dark:text-white/35">
                実況を待っています…
                <br />
                （自動実況を ON にするか「今の場面について話して」で開始）
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
