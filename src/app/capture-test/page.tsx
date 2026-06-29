import CaptureTestClient from "@/app/capture-test/CaptureTestClient";

/**
 * 映像取り込み（ticket 03）＋自動実況ループ（ticket 04）の暫定確認ページ。
 *
 * ticket 10（セッション画面統合）で本UIに置き換える前提の確認用ハーネス。
 * 本番のトップ/セッション画面ではない。
 */
export default function CaptureTestPage() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
      <h1 className="text-lg font-semibold">
        映像取り込み＋自動実況ループ 確認
      </h1>
      <p className="text-sm text-black/60 dark:text-white/60">
        OBSで仮想カメラを開始してから、カメラを選択してプレビューを確認します。
        自動実況ループONで画面が変わったときだけ「送信」され、手動ボタンは変化が
        無くても即送信します（送信はモックで、実況APIは ticket 07）。
      </p>
      <CaptureTestClient />
    </main>
  );
}
