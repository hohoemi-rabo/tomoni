"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import VideoPreview from "@/components/VideoPreview";
import { RECENT_LINES_KEEP, TTS_VOICES } from "@/lib/config";
import { useAutoNarration } from "@/hooks/useAutoNarration";
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
}: {
  playthroughId: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

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

  // 1回の実況送信：07 をストリーム fetch → 逐次表示＋逐次読み上げ。
  const onSend = useCallback(
    async (imageBase64: string, recentLinesArg: string[]) => {
      ttsRef.current.reset(); // 新しい発言。前の再生/バッファを破棄。
      setCurrentText("");

      const res = await fetch("/api/narrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playthroughId,
          imageBase64,
          recentLines: recentLinesArg,
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
      }
    },
    [playthroughId],
  );

  const auto = useAutoNarration({ videoRef, onSend });
  addRecentRef.current = auto.addRecentLine;

  return (
    <div className="flex flex-col gap-5">
      <VideoPreview onVideoElement={(el) => (videoRef.current = el)} />

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
          onClick={auto.triggerNow}
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
      </div>

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

      {/* 録画モード: AI発言だけを全画面・単色背景で大きく表示（他UIを覆う） */}
      {recording && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background text-foreground">
          <div className="flex items-center justify-end gap-3 p-3 text-sm text-black/40 dark:text-white/40">
            <button
              type="button"
              className="rounded px-2 py-1 hover:text-black dark:hover:text-white"
              onClick={() => setFontIdx((i) => Math.max(0, i - 1))}
              aria-label="文字を小さく"
            >
              A-
            </button>
            <button
              type="button"
              className="rounded px-2 py-1 hover:text-black dark:hover:text-white"
              onClick={() => setFontIdx((i) => Math.min(lastFontIdx, i + 1))}
              aria-label="文字を大きく"
            >
              A+
            </button>
            <button
              type="button"
              className="rounded px-2 py-1 hover:text-black dark:hover:text-white"
              onClick={() => setRecording(false)}
            >
              終了
            </button>
          </div>

          <div className="flex flex-1 items-center justify-center px-[6vw] pb-[6vh]">
            <p
              className={`mx-auto max-w-[24ch] whitespace-pre-wrap text-center font-semibold leading-snug ${RECORDING_FONT_STEPS[fontIdx]}`}
            >
              {currentText || " "}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
