"use client";

import { useCallback, useRef, useState } from "react";

import VideoPreview from "@/components/VideoPreview";
import { type SendPayload, useAutoNarration } from "@/hooks/useAutoNarration";

/**
 * 映像取り込み（ticket 03）＋自動実況ループ（ticket 04）の暫定確認デモ。
 *
 * 実況API（ticket 07）は未実装のため onSend はモック。ticket 10 の本UIで
 * 実APIに差し替える前提の確認用ハーネス。
 */
export default function CaptureTestClient() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const sendCountRef = useRef(0);
  const addRecentRef = useRef<(line: string) => void>(() => {});

  const [sendCount, setSendCount] = useState(0);
  const [log, setLog] = useState<string[]>([]);

  const pushLog = useCallback((line: string) => {
    setLog((prev) => [line, ...prev].slice(0, 8));
  }, []);

  // モック送信: 実APIの代わりに約0.8秒かけて完了する（busy 挙動の再現）。
  const onSend = useCallback(
    async ({ imageBase64, recentLines, isIdle }: SendPayload) => {
      const n = sendCountRef.current + 1;
      sendCountRef.current = n;
      setSendCount(n);
      pushLog(
        `送信#${n}${isIdle ? "[自発]" : "[変化]"}: ${Math.round((imageBase64.length * 3) / 4 / 1024)}KB / recent=${recentLines.length}`,
      );
      await new Promise((r) => setTimeout(r, 800));
      addRecentRef.current(`（送信#${n} の擬似応答）`);
    },
    [pushLog],
  );

  const auto = useAutoNarration({ videoRef, onSend });
  // 安定参照の addRecentLine をモックから使えるよう ref に載せる。
  addRecentRef.current = auto.addRecentLine;

  // VideoPreview は親が安定参照を渡す前提（SessionClient と同じ理由で固定する）。
  const handleVideoElement = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <VideoPreview onVideoElement={handleVideoElement} />

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={auto.enabled}
            onChange={(e) => auto.setEnabled(e.target.checked)}
          />
          自動実況ループ
        </label>
        <button
          type="button"
          className="rounded bg-foreground px-3 py-1 text-sm text-background disabled:opacity-50"
          onClick={() => auto.triggerNow()}
          disabled={auto.busy}
        >
          今の場面について話して
        </button>
      </div>

      <div className="flex flex-wrap gap-4 text-sm text-black/70 dark:text-white/70">
        <span>送信回数: {sendCount}</span>
        <span>直近 diff: {auto.lastDiff.toFixed(4)}</span>
        <span>生成中: {auto.busy ? "はい" : "いいえ"}</span>
      </div>

      {auto.lastError && (
        <p className="text-sm text-red-600 dark:text-red-400">
          エラー: {auto.lastError}
        </p>
      )}

      <ul className="font-mono text-xs text-black/60 dark:text-white/60">
        {log.map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
    </div>
  );
}
