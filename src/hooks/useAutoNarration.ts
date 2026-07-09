"use client";

import { type RefObject, useCallback, useEffect, useRef, useState } from "react";

import {
  AUTO_NARRATE_INTERVAL_MS,
  FRAME_DIFF_THRESHOLD,
  IDLE_CHATTER_MS,
  RECENT_LINES_KEEP,
} from "@/lib/config";
import { captureFrame, signatureDiff } from "@/lib/video/frame";

/** 1回ぶんの送信内容。引数が増えても呼び出しが読めるようオブジェクトで渡す。 */
export interface SendPayload {
  imageBase64: string;
  recentLines: string[];
  /** 手動トリガー時のプレイヤーの話しかけ（STT・任意・ticket 13）。 */
  userMessage?: string;
  /** 沈黙が続いたための自発発話か（ticket 15）。実況ではなく雑談させる。 */
  isIdle?: boolean;
}

/** 送信実行。実況APIは ticket 07/10 で注入する（ここでは未知）。 */
export type SendFn = (payload: SendPayload) => Promise<void>;

export interface UseAutoNarrationOptions {
  videoRef: RefObject<HTMLVideoElement | null>;
  onSend: SendFn;
  intervalMs?: number;
  threshold?: number;
  recentKeep?: number;
  idleMs?: number;
  /**
   * 自発発話を今してよいか。読み上げ中に撃つと前の発言を自分で踏み潰すため、
   * 消費側（読み上げキューを持つ側）に判断させる。既定は常に可。
   */
  canIdle?: () => boolean;
}

export interface UseAutoNarration {
  enabled: boolean;
  setEnabled: (on: boolean) => void;
  /** 変化検知を迂回して即時送信（手動「今の場面について話して」／STT の話しかけ）。 */
  triggerNow: (userMessage?: string) => void;
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
 * 変化が無いまま idleMs だけ沈黙したら、検知を迂回して自発発話する（ticket 15）。
 * 生成中は次の送信を抑止し、繰り返し発言とコストを防ぐ。
 */
export function useAutoNarration({
  videoRef,
  onSend,
  intervalMs = AUTO_NARRATE_INTERVAL_MS,
  threshold = FRAME_DIFF_THRESHOLD,
  recentKeep = RECENT_LINES_KEEP,
  idleMs = IDLE_CHATTER_MS,
  canIdle,
}: UseAutoNarrationOptions): UseAutoNarration {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastDiff, setLastDiff] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);

  // 再レンダーを避けたい可変値は ref に持つ。
  const onSendRef = useRef(onSend);
  onSendRef.current = onSend;
  const canIdleRef = useRef(canIdle);
  canIdleRef.current = canIdle;
  const busyRef = useRef(false);
  const lastSigRef = useRef<Uint8ClampedArray | null>(null);
  const recentRef = useRef<string[]>([]);
  // 沈黙の起点。send() が唯一の送信集約点なので、手動・STT でも正しく戻る。
  const lastSentAtRef = useRef(0);

  const addRecentLine = useCallback(
    (line: string) => {
      const next = [...recentRef.current, line];
      recentRef.current = next.slice(-recentKeep);
    },
    [recentKeep],
  );

  // 1回の送信処理。busy 管理と lastSig / 沈黙の起点の更新を内包する。
  const send = useCallback(
    async (
      base64: string,
      sig: Uint8ClampedArray,
      opts?: { userMessage?: string; isIdle?: boolean },
    ) => {
      busyRef.current = true;
      setBusy(true);
      // 静止画面での二重発火を防ぐため、送信が決まった時点で署名を更新。
      lastSigRef.current = sig;
      // 生成にかかった時間を沈黙に数えないよう、開始時点で時計を戻す。
      lastSentAtRef.current = Date.now();
      setLastError(null);
      try {
        await onSendRef.current({
          imageBase64: base64,
          recentLines: [...recentRef.current],
          userMessage: opts?.userMessage,
          isIdle: opts?.isIdle,
        });
      } catch (e) {
        setLastError(e instanceof Error ? e.message : String(e));
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [],
  );

  const triggerNow = useCallback(
    (userMessage?: string) => {
      const video = videoRef.current;
      if (!video || busyRef.current) return;
      const frame = captureFrame(video);
      if (!frame) return;
      void send(frame.base64, frame.signature, { userMessage });
    },
    [videoRef, send],
  );

  // 自動ループ: enabled の間だけ interval を張る。
  useEffect(() => {
    if (!enabled) return;
    // OFF→ON の直後に、古い時計で自発発話が即発火しないようにする。
    lastSentAtRef.current = Date.now();
    const id = window.setInterval(() => {
      const video = videoRef.current;
      if (!video || busyRef.current) return;
      const frame = captureFrame(video);
      if (!frame) return;
      const diff = signatureDiff(lastSigRef.current, frame.signature);
      setLastDiff(diff);
      // 初回（lastSig=null→diff=1）または変化が閾値超過のときだけ送る。
      if (diff > threshold) {
        void send(frame.base64, frame.signature);
        return;
      }
      // 変化が無くても、沈黙が続いたら自分から喋る（ticket 15）。
      // ただし読み上げ中は見送る（撃つと前の発言が途中で切れる）。
      if (
        Date.now() - lastSentAtRef.current >= idleMs &&
        (canIdleRef.current?.() ?? true)
      ) {
        void send(frame.base64, frame.signature, { isIdle: true });
      }
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [enabled, intervalMs, threshold, idleMs, videoRef, send]);

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
