"use client";

import { useRef, useState } from "react";

import { TTS_VOICES } from "@/lib/config";
import { useTts } from "@/hooks/useTts";

/**
 * 読み上げ（ticket 08）の暫定確認デモ。実況ストリームの代わりに、テキストを
 * 数文字ずつ時間差で `feed` し、最後に `flush` してストリーム終端を再現する。
 * ticket 10 の本UIで実況ストリーム（07）に差し替える前提の確認用ハーネス。
 */

const SAMPLE_TEXT =
  "やあ、戦友。今日も一緒に戦おう。おっと、自軍のユニットが前に出たね。" +
  "気をつけて、敵が近いよ。慎重にいこう。当たれば気持ちいいけど、外すと悔しいよね。";

export default function TtsTestClient() {
  const tts = useTts();
  const [text, setText] = useState(SAMPLE_TEXT);
  const [streaming, setStreaming] = useState(false);
  const timerRef = useRef<number | null>(null);

  // テキストを数文字ずつ feed して実況ストリームを擬似再現する。
  const startPseudoStream = () => {
    if (streaming) return;
    tts.reset();
    setStreaming(true);
    const chars = Array.from(text);
    let i = 0;
    timerRef.current = window.setInterval(() => {
      // 1tick で 2〜4 文字流す（チャンク境界が文末をまたぐ場合の確認も兼ねる）。
      const step = 2 + (i % 3);
      tts.feed(chars.slice(i, i + step).join(""));
      i += step;
      if (i >= chars.length) {
        if (timerRef.current !== null) window.clearInterval(timerRef.current);
        timerRef.current = null;
        tts.flush();
        setStreaming(false);
      }
    }, 120);
  };

  return (
    <div className="flex flex-col gap-4">
      <textarea
        className="min-h-28 rounded border border-black/15 bg-transparent p-3 text-sm dark:border-white/15"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={tts.enabled}
            onChange={(e) => tts.setEnabled(e.target.checked)}
          />
          読み上げ ON
        </label>

        <label className="flex items-center gap-2 text-sm">
          ボイス
          <select
            className="rounded border border-black/15 bg-transparent px-2 py-1 dark:border-white/15"
            value={tts.voice}
            onChange={(e) => tts.setVoice(e.target.value)}
          >
            {TTS_VOICES.map((v) => (
              <option key={v} value={v}>
                {v.replace("ja-JP-Chirp3-HD-", "")}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className="rounded bg-foreground px-3 py-1 text-sm text-background disabled:opacity-50"
          onClick={startPseudoStream}
          disabled={streaming}
        >
          擬似ストリームで読み上げ
        </button>

        <button
          type="button"
          className="rounded border border-black/15 px-3 py-1 text-sm dark:border-white/15"
          onClick={() => tts.reset()}
        >
          停止・リセット
        </button>
      </div>

      <div className="flex flex-wrap gap-4 text-sm text-black/70 dark:text-white/70">
        <span>ストリーム中: {streaming ? "はい" : "いいえ"}</span>
        <span>再生中: {tts.speaking ? "はい" : "いいえ"}</span>
        <span>未再生キュー: {tts.queueLength}</span>
      </div>

      {tts.lastError && (
        <p className="text-sm text-red-600 dark:text-red-400">
          エラー: {tts.lastError}
        </p>
      )}
    </div>
  );
}
