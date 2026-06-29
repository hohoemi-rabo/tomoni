/**
 * 映像ソースの差し替え可能な抽象（REQUIREMENTS §6.1）。
 *
 * MVP は OBSバーチャルカメラを `getUserMedia` で受ける `UserMediaSource` のみ。
 * 将来 `getDisplayMedia`（画面共有）実装を同じインターフェースで並列に足せる。
 */

export interface VideoSource {
  /** 指定デバイスで取得を開始し、MediaStream を返す。再呼び出しで切替。 */
  start(deviceId?: string): Promise<MediaStream>;
  /** トラックを停止して解放する。 */
  stop(): void;
  /** 現在のストリーム（未開始なら null）。 */
  getStream(): MediaStream | null;
}

/** UI 側でメッセージを出し分けるためのエラー種別。 */
export type VideoSourceErrorKind =
  | "permission" // 権限拒否
  | "not-found" // デバイスが見つからない／制約に合致しない
  | "unsupported" // ブラウザが mediaDevices 非対応
  | "unknown";

/** 種別付きの映像ソースエラー。 */
export class VideoSourceError extends Error {
  constructor(
    public readonly kind: VideoSourceErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "VideoSourceError";
  }
}
