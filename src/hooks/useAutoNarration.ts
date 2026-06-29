"use client";

import { type RefObject, useCallback, useEffect, useRef, useState } from "react";

import {
  AUTO_NARRATE_INTERVAL_MS,
  FRAME_DIFF_THRESHOLD,
  RECENT_LINES_KEEP,
} from "@/lib/config";
import { captureFrame, signatureDiff } from "@/lib/video/frame";

/** 送信実行。実況APIは ticket 07/10 で注入する（ここでは未知）。 */
export type SendFn = (
  imageBase64: string,
  recentLines: string[],
) => Promise<void>;

export interface UseAutoNarrationOptions {
  videoRef: RefObject<HTMLVideoElement | null>;
  onSend: SendFn;
  intervalMs?: number;
  threshold?: number;
  recentKeep?: number;
}

export interface UseAutoNarration {
  enabled: boolean;
  setEnabled: (on: boolean) => void;
  /** 変化検知を迂回して即時送信（手動「今の場面について話して」）。 */
  triggerNow: () => void;
  /** 直近のAI発言を保持（消費側が確定文を push）。 */
  addRecentLine: (line: string) => void;
  /** 生成中（次の送信を抑止中）か。 */
  busy: boolean;
  /** 直近 tick の変化量（0〜1・UI表示用）。 */
  lastDiff: number;
  /** 直近送信でのエラー（握りつぶさず保持）。 */
  lastError: string | null;
}

/**
 * 自動実況ループ（REQUIREMENTS §6.2 / §6.3）。
 * 一定間隔でフレームを評価し、前回送信フレームから「変化したときだけ」送る。
 * 生成中は次の送信を抑止し、繰り返し発言とコストを防ぐ。
 */
export function useAutoNarration({
  videoRef,
  onSend,
  intervalMs = AUTO_NARRATE_INTERVAL_MS,
  threshold = FRAME_DIFF_THRESHOLD,
  recentKeep = RECENT_LINES_KEEP,
}: UseAutoNarrationOptions): UseAutoNarration {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastDiff, setLastDiff] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);

  // 再レンダーを避けたい可変値は ref に持つ。
  const onSendRef = useRef(onSend);
  onSendRef.current = onSend;
  const busyRef = useRef(false);
  const lastSigRef = useRef<Uint8ClampedArray | null>(null);
  const recentRef = useRef<string[]>([]);

  const addRecentLine = useCallback(
    (line: string) => {
      const next = [...recentRef.current, line];
      recentRef.current = next.slice(-recentKeep);
    },
    [recentKeep],
  );

  // 1回の送信処理。busy 管理と lastSig 更新を内包する。
  const send = useCallback(async (base64: string, sig: Uint8ClampedArray) => {
    busyRef.current = true;
    setBusy(true);
    // 静止画面での二重発火を防ぐため、送信が決まった時点で署名を更新。
    lastSigRef.current = sig;
    setLastError(null);
    try {
      await onSendRef.current(base64, [...recentRef.current]);
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  const triggerNow = useCallback(() => {
    const video = videoRef.current;
    if (!video || busyRef.current) return;
    const frame = captureFrame(video);
    if (!frame) return;
    void send(frame.base64, frame.signature);
  }, [videoRef, send]);

  // 自動ループ: enabled の間だけ interval を張る。
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => {
      const video = videoRef.current;
      if (!video || busyRef.current) return;
      const frame = captureFrame(video);
      if (!frame) return;
      const diff = signatureDiff(lastSigRef.current, frame.signature);
      setLastDiff(diff);
      // 初回（lastSig=null→diff=1）または変化が閾値超過のときだけ送る。
      if (diff > threshold) void send(frame.base64, frame.signature);
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [enabled, intervalMs, threshold, videoRef, send]);

  return {
    enabled,
    setEnabled,
    triggerNow,
    addRecentLine,
    busy,
    lastDiff,
    lastError,
  };
}
