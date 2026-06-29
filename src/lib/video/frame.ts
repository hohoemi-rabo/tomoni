import {
  FRAME_DIFF_SAMPLE_LONG_EDGE_PX,
  FRAME_DOWNSCALE_LONG_EDGE_PX,
  FRAME_JPEG_QUALITY,
} from "@/lib/config";

/**
 * `<video>` からのフレーム取得・ダウンスケール・変化検知（REQUIREMENTS §6.2）。
 * クライアント専用（canvas 利用）。純粋な処理のみで React に依存しない。
 */

export interface CapturedFrame {
  /** 送信用 JPEG の base64（data URL 接頭辞なし）。 */
  base64: string;
  /** 変化検知用のグレースケール署名（極小画像の輝度列）。 */
  signature: Uint8ClampedArray;
}

export interface CaptureOptions {
  longEdge?: number;
  quality?: number;
  sigLongEdge?: number;
}

// canvas は使い回す（毎フレームの生成コストを避ける）。
let sendCanvas: HTMLCanvasElement | null = null;
let sigCanvas: HTMLCanvasElement | null = null;

function getCanvas(which: "send" | "sig"): HTMLCanvasElement {
  if (which === "send") {
    if (!sendCanvas) sendCanvas = document.createElement("canvas");
    return sendCanvas;
  }
  if (!sigCanvas) sigCanvas = document.createElement("canvas");
  return sigCanvas;
}

/** 長辺を `longEdge` に収めた縮小サイズを返す（拡大はしない）。 */
function scaledSize(
  w: number,
  h: number,
  longEdge: number,
): { width: number; height: number } {
  const scale = Math.min(1, longEdge / Math.max(w, h));
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

/**
 * 現フレームを取得する。映像が未準備（`videoWidth === 0`）なら null。
 * 送信用 JPEG(base64) と、変化検知用のグレースケール署名を同時に作る。
 */
export function captureFrame(
  video: HTMLVideoElement,
  opts: CaptureOptions = {},
): CapturedFrame | null {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return null;

  const longEdge = opts.longEdge ?? FRAME_DOWNSCALE_LONG_EDGE_PX;
  const quality = opts.quality ?? FRAME_JPEG_QUALITY;
  const sigLongEdge = opts.sigLongEdge ?? FRAME_DIFF_SAMPLE_LONG_EDGE_PX;

  // 送信用 JPEG。
  const send = scaledSize(w, h, longEdge);
  const canvas = getCanvas("send");
  canvas.width = send.width;
  canvas.height = send.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(video, 0, 0, send.width, send.height);
  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);

  // 変化検知用の極小グレースケール署名。
  const sig = scaledSize(w, h, sigLongEdge);
  const sc = getCanvas("sig");
  sc.width = sig.width;
  sc.height = sig.height;
  const sctx = sc.getContext("2d");
  if (!sctx) return null;
  sctx.drawImage(video, 0, 0, sig.width, sig.height);
  const { data } = sctx.getImageData(0, 0, sig.width, sig.height);
  const signature = new Uint8ClampedArray(sig.width * sig.height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    // 知覚輝度（Rec. 601 係数）でグレースケール化。
    signature[p] = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
  }

  return { base64, signature };
}

/**
 * 2つの署名の変化量を 0〜1 で返す（平均絶対差 / 255）。
 * 寸法が一致しない、または片方が無いときは 1（=必ず送信する）。
 */
export function signatureDiff(
  a: Uint8ClampedArray | null,
  b: Uint8ClampedArray | null,
): number {
  if (!a || !b || a.length !== b.length || a.length === 0) return 1;
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
  return sum / a.length / 255;
}
