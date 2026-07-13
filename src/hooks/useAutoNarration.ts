"use client";

import { type RefObject, useCallback, useEffect, useRef, useState } from "react";

import {
  AUTO_NARRATE_INTERVAL_MS,
  FRAME_DIFF_THRESHOLD,
  RECENT_LINES_KEEP,
  SPEAK_INTERVAL_MAX_MS,
  SPEAK_INTERVAL_MIN_MS,
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
  /** 実況／雑談の出し分けのしきい値。テンポには効かない（ticket 19）。 */
  threshold?: number;
  recentKeep?: number;
  /** 発話間隔の下限・上限（この範囲の一様乱数を毎回引き直す）。 */
  minGapMs?: number;
  maxGapMs?: number;
  /**
   * 今から新しい発言を始めてよいか（自動ループの2分岐に共通）。読み上げ中に撃つと
   * `onSend` 冒頭の reset() で前の発言が途中で切れるため、消費側（読み上げキューを
   * 持つ側）に判断させる。既定は常に可。
   *
   * 手動トリガー（`triggerNow`）には掛けない。プレイヤーが自分で押した／話しかけた
   * のに黙るのは、割り込みではなく故障に見えるため。
   */
  canSpeak?: () => boolean;
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
 *
 * **発話するかどうかは時間だけで決まる**（ticket 19）。前回の発話から
 * minGapMs〜maxGapMs（毎回引き直す乱数）が経ったら喋る。画面の変化量は
 * 「そのとき実況させるか（変化あり）雑談させるか（変化なし）」の出し分けにしか
 * 使わない。変化をテンポの門番にすると、取り込みノイズやカーソル点滅で喋り出す。
 *
 * 生成中（および `canSpeak` が偽の間＝読み上げ中・ticket 18）は次の送信を抑止し、
 * 発言が途中で切れることと、繰り返し発言・コストを防ぐ。
 */
export function useAutoNarration({
  videoRef,
  onSend,
  intervalMs = AUTO_NARRATE_INTERVAL_MS,
  threshold = FRAME_DIFF_THRESHOLD,
  recentKeep = RECENT_LINES_KEEP,
  minGapMs = SPEAK_INTERVAL_MIN_MS,
  maxGapMs = SPEAK_INTERVAL_MAX_MS,
  canSpeak,
}: UseAutoNarrationOptions): UseAutoNarration {
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastDiff, setLastDiff] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);

  // 再レンダーを避けたい可変値は ref に持つ。
  const onSendRef = useRef(onSend);
  onSendRef.current = onSend;
  const canSpeakRef = useRef(canSpeak);
  canSpeakRef.current = canSpeak;
  const busyRef = useRef(false);
  const lastSigRef = useRef<Uint8ClampedArray | null>(null);
  const recentRef = useRef<string[]>([]);
  // 沈黙の起点。send() が唯一の送信集約点なので、手動・STT でも正しく戻る。
  const lastSentAtRef = useRef(0);
  // 今回の発話に使う間隔（ミリ秒）。send() のたびに引き直す。
  const gapRef = useRef(0);
  const gapRangeRef = useRef({ min: minGapMs, max: maxGapMs });
  gapRangeRef.current = { min: minGapMs, max: maxGapMs };

  // 次の発話までの間隔を引き直す。等間隔だと機械的に聞こえるため毎回ばらす。
  const rollGap = useCallback(() => {
    const { min, max } = gapRangeRef.current;
    gapRef.current = min + Math.random() * Math.max(0, max - min);
  }, []);

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
      // 次の実況／雑談の出し分けは、この「送ったフレーム」との差分で決まる。
      lastSigRef.current = sig;
      // 生成にかかった時間を間隔に数えないよう、開始時点で時計を戻す。
      // 手動・STT もここを通るので、押した直後にループが被せてこない。
      lastSentAtRef.current = Date.now();
      rollGap(); // 次の間隔をここで引き直す（毎回ばらつく）。
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
    [rollGap],
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
    // ON にした直後は待たせず、最初の1回をすぐ喋らせる（gap=0）。以降は send() が
    // 引き直した乱数間隔になる。lastSentAt を今にしておかないと、古い時計で
    // 「もう十分待った」と判定されてしまう。
    lastSentAtRef.current = Date.now();
    gapRef.current = 0;
    const id = window.setInterval(() => {
      const video = videoRef.current;
      if (!video || busyRef.current) return;
      const frame = captureFrame(video);
      if (!frame) return;
      // diff はテンポには使わない。UI表示と、実況／雑談の出し分けにだけ使う。
      const diff = signatureDiff(lastSigRef.current, frame.signature);
      setLastDiff(diff);
      // 読み上げが鳴り終わるまでは始めない（ticket 18）。撃つと onSend 冒頭の
      // reset() で前の発言が途中で切れる。
      if (!(canSpeakRef.current?.() ?? true)) return;
      // 発話するかどうかは時間だけで決める（ticket 19）。
      if (Date.now() - lastSentAtRef.current < gapRef.current) return;
      // 喋ると決めた。前回送ったフレームから変化していれば実況、していなければ雑談。
      const isIdle = diff <= threshold;
      void send(frame.base64, frame.signature, { isIdle });
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
