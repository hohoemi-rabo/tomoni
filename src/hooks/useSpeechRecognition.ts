"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { STT_LANG } from "@/lib/config";

/**
 * 音声認識（STT・Web Speech API）の最小ラッパ（REQUIREMENTS §7.5・ticket 13・任意）。
 * クライアント専用・ブラウザ依存。非対応環境では `supported=false` で無効化する。
 *
 * strict TS のため、標準 lib.dom に無い SpeechRecognition の最小インターフェースを
 * ここで宣言する（`any` を使わない）。
 */

interface SpeechRecognitionAlternative {
  transcript: string;
}
interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: SpeechRecognitionAlternative;
}
interface SpeechRecognitionResultList {
  readonly length: number;
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionEventLike {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}
interface SpeechRecognitionErrorEventLike {
  readonly error: string;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

/** ブラウザから SpeechRecognition コンストラクタを取り出す（無ければ null）。 */
function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface UseSpeechRecognitionOptions {
  lang?: string;
  /** 確定した発話テキストを受け取る。 */
  onResult: (text: string) => void;
}

export interface UseSpeechRecognition {
  /** ブラウザが音声認識に対応しているか。 */
  supported: boolean;
  /** 聞き取り中か。 */
  listening: boolean;
  /** 暫定（未確定）の認識テキスト。 */
  interim: string;
  /** 直近のエラー（マイク拒否・非対応など）。 */
  error: string | null;
  start: () => void;
  stop: () => void;
}

export function useSpeechRecognition({
  lang = STT_LANG,
  onResult,
}: UseSpeechRecognitionOptions): UseSpeechRecognition {
  const [supported] = useState(() => getRecognitionCtor() !== null);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  // stale closure を避けるため onResult は ref 経由で参照する。
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  const start = useCallback(() => {
    if (listening) return;
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setError("このブラウザは音声認識に対応していません。");
      return;
    }
    setError(null);
    setInterim("");

    const recognition = new Ctor();
    recognition.lang = lang;
    recognition.continuous = false; // 押して話す（1発話ごと）。
    recognition.interimResults = true;

    recognition.onresult = (e) => {
      let finalText = "";
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const text = res[0]?.transcript ?? "";
        if (res.isFinal) finalText += text;
        else interimText += text;
      }
      if (interimText) setInterim(interimText);
      if (finalText) {
        setInterim("");
        onResultRef.current(finalText);
      }
    };
    recognition.onerror = (e) => {
      const msg =
        e.error === "not-allowed" || e.error === "service-not-allowed"
          ? "マイクの使用が許可されていません。ブラウザの権限を確認してください。"
          : e.error === "no-speech"
            ? "音声が聞き取れませんでした。もう一度お試しください。"
            : `音声認識エラー: ${e.error}`;
      setError(msg);
    };
    recognition.onend = () => {
      setListening(false);
      setInterim("");
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    setListening(true);
    try {
      recognition.start();
    } catch {
      // 連続 start などの例外は握って listening を戻す。
      setListening(false);
      recognitionRef.current = null;
    }
  }, [lang, listening]);

  // アンマウント時に確実に停止する。
  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    };
  }, []);

  return { supported, listening, interim, error, start, stop };
}
