"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { DEFAULT_TTS_VOICE } from "@/lib/config";
import { takeSentences } from "@/lib/sentence";

/**
 * 読み上げ逐次再生フック（REQUIREMENTS §4 / §7.1・ticket 08）。クライアント専用。
 *
 * ストリーミングで届く実況テキストを `feed` で受け、文末が確定した文を順に
 * `/api/tts` で音声化して再生する。テンポを保つため「1文先読みパイプライン」
 * （現在の文を再生中に次の文の音声を先取得）で文間の間を詰める。
 *
 * 音声再生だけに専念し、テキスト表示は消費側（ticket 10）の責務。TTS の失敗は
 * その文を飛ばして `lastError` に記録するだけで、キュー全体は止めない。
 */

export interface UseTtsOptions {
  defaultVoice?: string;
}

export interface UseTts {
  /** 読み上げ ON/OFF。OFF にすると再生停止＋キュー破棄。 */
  enabled: boolean;
  setEnabled: (on: boolean) => void;
  /** ボイス選択（次の取得から反映）。 */
  voice: string;
  setVoice: (voice: string) => void;
  /** ストリーミング chunk を与える。確定した文を順にキューへ。 */
  feed: (chunk: string) => void;
  /** ストリーム終了時に未確定の残りを確定してキューへ。 */
  flush: () => void;
  /** 新しい発言の開始時にバッファ・キュー・再生を破棄する。 */
  reset: () => void;
  /** 再生中（ポンプ稼働中）か。 */
  speaking: boolean;
  /** 未再生キューの長さ（UI表示用）。 */
  queueLength: number;
  /** 直近の読み上げ失敗（握りつぶさず保持）。 */
  lastError: string | null;
}

export function useTts(opts: UseTtsOptions = {}): UseTts {
  const [enabled, setEnabledState] = useState(false);
  const [voice, setVoiceState] = useState(opts.defaultVoice ?? DEFAULT_TTS_VOICE);
  const [speaking, setSpeaking] = useState(false);
  const [queueLength, setQueueLength] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);

  // 再生ループの stale closure を避けるため可変値は ref に持つ（useAutoNarration と同手法）。
  const enabledRef = useRef(enabled);
  const voiceRef = useRef(voice);
  const bufferRef = useRef(""); // 未確定の受信テキスト。
  const queueRef = useRef<string[]>([]); // 確定済みで未再生の文。
  const runningRef = useRef(false); // ポンプ多重起動の防止。
  const audioRef = useRef<HTMLAudioElement | null>(null);
  /**
   * 再生中の1文を「中断で終わらせる」ための解決関数（ticket 22 で判明した停止バグ）。
   *
   * `stopAndClear` は `pause()` するが、**pause では `ended` も `error` も発火しない**。
   * それを待っている `playBase64` の Promise が永久に解決されず、ポンプが抜けられずに
   * `speaking` が真のまま張り付く → 自動ループの「読み上げ中は始めない」関門（ticket 18）が
   * 二度と開かず、AIが黙り込む。中断時はここから明示的に解決してやる。
   */
  const resolvePlayRef = useRef<(() => void) | null>(null);
  /**
   * 世代番号。`reset()`（＝新しい発言の開始）のたびに進める。走っている古いポンプは
   * 世代のズレを見て自分から降りる——さもないと reset 前に先読みしていた音声が、
   * 新しい発言のあとから鳴り出す。
   */
  const genRef = useRef(0);

  const updateQueueLength = useCallback(() => {
    setQueueLength(queueRef.current.length);
  }, []);

  // 1文を /api/tts で音声化。失敗は lastError に記録し null を返す（キューは止めない）。
  const fetchTts = useCallback(async (text: string): Promise<string | null> => {
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice: voiceRef.current }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(data?.error ?? `読み上げ取得に失敗(HTTP ${res.status})`);
      }
      const { audioBase64 } = (await res.json()) as { audioBase64?: string };
      return audioBase64 ?? null;
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, []);

  // base64 mp3 を再生し、再生終了（または失敗・中断）で解決する。
  const playBase64 = useCallback((b64: string): Promise<void> => {
    return new Promise((resolve) => {
      let audio = audioRef.current;
      if (!audio) {
        audio = new Audio();
        audioRef.current = audio;
      }
      const el = audio;
      const done = () => {
        el.removeEventListener("ended", done);
        el.removeEventListener("error", done);
        resolvePlayRef.current = null;
        resolve();
      };
      // 中断（stopAndClear）からも終わらせられるようにしておく。
      resolvePlayRef.current = done;
      el.addEventListener("ended", done);
      el.addEventListener("error", done);
      el.src = `data:audio/mpeg;base64,${b64}`;
      el.play().catch(() => {
        setLastError("音声の再生に失敗しました。");
        done();
      });
    });
  }, []);

  const dequeue = useCallback((): string | null => {
    const s = queueRef.current.shift() ?? null;
    updateQueueLength();
    return s;
  }, [updateQueueLength]);

  // 再生ポンプ: 現在の文を再生しながら次の文を先取得する（プリフェッチ深さ1）。
  const pump = useCallback(async (): Promise<void> => {
    if (runningRef.current) return;
    runningRef.current = true;
    setSpeaking(true);
    // このポンプの世代。reset() が入ったら（世代がズレたら）自分は降りる。
    const myGen = genRef.current;
    const alive = () => enabledRef.current && genRef.current === myGen;
    try {
      let pending: Promise<string | null> | null = null;
      while (alive() && (pending || queueRef.current.length)) {
        let current = pending;
        pending = null;
        if (!current) {
          const s = dequeue();
          if (s == null) break;
          current = fetchTts(s);
        }
        // 現在の再生を待つ間に次の文の音声を先取得しておく。
        const next = queueRef.current.length ? dequeue() : null;
        if (next != null) pending = fetchTts(next);

        const b64 = await current;
        if (!alive()) break; // reset された。先読み済みの音声は捨てる（鳴らさない）。
        if (b64) await playBase64(b64);
      }
    } finally {
      runningRef.current = false;
      setSpeaking(false);
    }
    // ポンプ終了直前に積まれた文を取りこぼさないよう再確認する
    // （reset 直後に新しい発言の文が積まれているのが典型）。
    if (enabledRef.current && queueRef.current.length) void pump();
  }, [dequeue, fetchTts, playBase64]);

  const enqueue = useCallback(
    (sentence: string) => {
      queueRef.current.push(sentence);
      updateQueueLength();
      void pump();
    },
    [pump, updateQueueLength],
  );

  const feed = useCallback(
    (chunk: string) => {
      bufferRef.current += chunk;
      const { sentences, rest } = takeSentences(bufferRef.current);
      bufferRef.current = rest;
      if (!enabledRef.current) return; // OFF 中はキューに積まない（あとで再生しない）。
      for (const s of sentences) enqueue(s);
    },
    [enqueue],
  );

  const flush = useCallback(() => {
    const rest = bufferRef.current.trim();
    bufferRef.current = "";
    if (rest && enabledRef.current) enqueue(rest);
  }, [enqueue]);

  // 再生停止＋バッファ/キュー破棄（OFF・reset・unmount で共有）。
  const stopAndClear = useCallback(() => {
    genRef.current += 1; // 走っているポンプに「降りろ」と伝える。
    queueRef.current = [];
    bufferRef.current = "";
    updateQueueLength();
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    // pause() では ended も error も出ない。待っている再生 Promise をここで終わらせる。
    // これを忘れると speaking が真のまま張り付き、自動ループが二度と喋らなくなる。
    resolvePlayRef.current?.();
  }, [updateQueueLength]);

  const reset = useCallback(() => {
    stopAndClear();
    setLastError(null);
  }, [stopAndClear]);

  const setEnabled = useCallback(
    (on: boolean) => {
      enabledRef.current = on;
      setEnabledState(on);
      if (!on) stopAndClear();
    },
    [stopAndClear],
  );

  const setVoice = useCallback((v: string) => {
    voiceRef.current = v;
    setVoiceState(v);
  }, []);

  // unmount 時に再生を止める。
  useEffect(() => () => stopAndClear(), [stopAndClear]);

  return {
    enabled,
    setEnabled,
    voice,
    setVoice,
    feed,
    flush,
    reset,
    speaking,
    queueLength,
    lastError,
  };
}
