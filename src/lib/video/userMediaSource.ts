import {
  type VideoSource,
  VideoSourceError,
  type VideoSourceErrorKind,
} from "@/lib/video/types";

/**
 * OBSバーチャルカメラを偽カメラとして `getUserMedia` で受ける VideoSource 実装。
 * 物理カメラは不要（OBSの画面を横流しする偽カメラ・REQUIREMENTS §6.1）。
 * クライアント専用。
 */
export class UserMediaSource implements VideoSource {
  private stream: MediaStream | null = null;

  async start(deviceId?: string): Promise<MediaStream> {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      throw new VideoSourceError(
        "unsupported",
        "このブラウザはカメラ入力（mediaDevices）に対応していません。",
      );
    }

    // デバイス切替時は既存ストリームを解放してから取り直す。
    this.stop();

    const video: MediaTrackConstraints | boolean = deviceId
      ? { deviceId: { exact: deviceId } }
      : true;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video,
        audio: false,
      });
      this.stream = stream;
      return stream;
    } catch (error) {
      throw normalizeMediaError(error);
    }
  }

  stop(): void {
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
  }

  getStream(): MediaStream | null {
    return this.stream;
  }
}

/** DOMException 等を種別付き VideoSourceError に正規化する。 */
function normalizeMediaError(error: unknown): VideoSourceError {
  const name = error instanceof DOMException ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);

  const kind: VideoSourceErrorKind =
    name === "NotAllowedError" || name === "SecurityError"
      ? "permission"
      : name === "NotFoundError" ||
          name === "OverconstrainedError" ||
          name === "DevicesNotFoundError"
        ? "not-found"
        : "unknown";

  const friendly =
    kind === "permission"
      ? "カメラへのアクセスが拒否されました。ブラウザの権限を許可してください。"
      : kind === "not-found"
        ? "指定したカメラが見つかりません。OBSの仮想カメラを開始しているか確認してください。"
        : `カメラの取得に失敗しました: ${message}`;

  return new VideoSourceError(kind, friendly);
}

/**
 * 映像入力デバイスを列挙する。
 * 注意: デバイスの `label` は一度カメラ権限が付与されるまで空になる。UI では
 * 先に start() で権限を得てから再列挙してラベルを表示すること。
 */
export async function listVideoInputDevices(): Promise<MediaDeviceInfo[]> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
    throw new VideoSourceError(
      "unsupported",
      "このブラウザはデバイス列挙（enumerateDevices）に対応していません。",
    );
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices.filter((d) => d.kind === "videoinput");
}
