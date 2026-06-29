"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  UserMediaSource,
  listVideoInputDevices,
} from "@/lib/video/userMediaSource";
import { VideoSourceError } from "@/lib/video/types";

const DEVICE_STORAGE_KEY = "tomoni.videoDeviceId";

export interface VideoPreviewProps {
  /** ストリーム確定/解放を親（ticket 04/10）へ通知。フレーム取得に使う。 */
  onStreamChange?: (stream: MediaStream | null) => void;
  /** `<video>` 要素を親へ渡す（フレーム取得＝ticket 04 がこの要素を読む）。 */
  onVideoElement?: (el: HTMLVideoElement | null) => void;
}

/**
 * OBSバーチャルカメラのプレビュー（クライアント専用・REQUIREMENTS §6.1 / §10）。
 * デバイス選択・プレビュー・エラー表示・選択の記憶を担う。フレーム切り出しは
 * ここでは行わない（ticket 04）。
 */
export default function VideoPreview({
  onStreamChange,
  onVideoElement,
}: VideoPreviewProps) {
  const sourceRef = useRef<UserMediaSource | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // 内部 ref に保持しつつ、親（ticket 04/10）へも要素を渡す callback ref。
  const setVideoEl = useCallback(
    (el: HTMLVideoElement | null) => {
      videoRef.current = el;
      onVideoElement?.(el);
    },
    [onVideoElement],
  );

  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // UserMediaSource は1インスタンスを使い回す。
  const getSource = useCallback(() => {
    if (!sourceRef.current) sourceRef.current = new UserMediaSource();
    return sourceRef.current;
  }, []);

  const refreshDevices = useCallback(async () => {
    try {
      const list = await listVideoInputDevices();
      setDevices(list);
      return list;
    } catch {
      // 列挙非対応などは start 時のエラーで扱う。ここでは黙って空に。
      setDevices([]);
      return [];
    }
  }, []);

  // マウント時: 前回選択の復元と、可能ならデバイス列挙（ラベルは権限取得後に出る）。
  useEffect(() => {
    const saved = window.localStorage.getItem(DEVICE_STORAGE_KEY);
    if (saved) setSelectedDeviceId(saved);
    void refreshDevices();
    return () => {
      sourceRef.current?.stop();
      onStreamChange?.(null);
    };
    // onStreamChange は親が安定参照で渡す前提。マウント/アンマウントのみで動かす。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshDevices]);

  const start = useCallback(
    async (deviceId: string) => {
      setError(null);
      try {
        const stream = await getSource().start(deviceId || undefined);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {
            /* 自動再生制約は muted で回避済み。失敗は無視。 */
          });
        }
        setActive(true);
        onStreamChange?.(stream);

        // ストリーム切断（OBS仮想カメラ停止など）を検知して表示。
        for (const track of stream.getTracks()) {
          track.addEventListener("ended", () => {
            setActive(false);
            onStreamChange?.(null);
            setError("映像ソースが切断されました。OBSの仮想カメラを確認してください。");
          });
        }

        // 権限取得後はラベルが見えるので再列挙。
        const list = await refreshDevices();
        // 実際に割り当てられたデバイスを選択状態に反映（deviceId 未指定時）。
        const activeId = stream.getVideoTracks()[0]?.getSettings().deviceId;
        const nextId = deviceId || activeId || list[0]?.deviceId || "";
        if (nextId) {
          setSelectedDeviceId(nextId);
          window.localStorage.setItem(DEVICE_STORAGE_KEY, nextId);
        }
      } catch (e) {
        setActive(false);
        onStreamChange?.(null);
        setError(
          e instanceof VideoSourceError
            ? e.message
            : `カメラの取得に失敗しました: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    },
    [getSource, onStreamChange, refreshDevices],
  );

  const handleDeviceChange = useCallback(
    (deviceId: string) => {
      setSelectedDeviceId(deviceId);
      window.localStorage.setItem(DEVICE_STORAGE_KEY, deviceId);
      if (active) void start(deviceId);
    },
    [active, start],
  );

  const handleStop = useCallback(() => {
    getSource().stop();
    if (videoRef.current) videoRef.current.srcObject = null;
    setActive(false);
    onStreamChange?.(null);
  }, [getSource, onStreamChange]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="rounded border border-black/15 px-2 py-1 text-sm dark:border-white/20 dark:bg-black/30"
          value={selectedDeviceId}
          onChange={(e) => handleDeviceChange(e.target.value)}
        >
          <option value="">カメラを選択（OBS Virtual Camera）</option>
          {devices.map((d, i) => (
            <option key={d.deviceId || i} value={d.deviceId}>
              {d.label || `カメラ ${i + 1}（権限許可で名称表示）`}
            </option>
          ))}
        </select>

        {active ? (
          <button
            type="button"
            className="rounded bg-foreground px-3 py-1 text-sm text-background"
            onClick={handleStop}
          >
            停止
          </button>
        ) : (
          <button
            type="button"
            className="rounded bg-foreground px-3 py-1 text-sm text-background"
            onClick={() => void start(selectedDeviceId)}
          >
            カメラを開始
          </button>
        )}
      </div>

      {error && (
        <p className="rounded border border-red-400/50 bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <video
        ref={setVideoEl}
        className="w-full max-w-2xl rounded bg-black"
        muted
        playsInline
        autoPlay
      />
    </div>
  );
}
