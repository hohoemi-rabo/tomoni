import TtsTestClient from "@/app/tts-test/TtsTestClient";

/**
 * 読み上げ（ticket 08）の暫定確認ページ。
 *
 * テキストを擬似ストリームで `useTts` に流し込み、文単位の逐次読み上げ・
 * ボイス選択・ON/OFF を実機確認する。ticket 10/11 で本UIに折り込む前提の
 * 確認用ハーネスで、本番のセッション画面ではない。
 */
export default function TtsTestPage() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 p-8">
      <h1 className="text-lg font-semibold">読み上げ（TTS）確認</h1>
      <p className="text-sm text-black/60 dark:text-white/60">
        読み上げを ON にし、ボイスを選んで「擬似ストリームで読み上げ」を押すと、
        テキストを少しずつ流し込みながら文末が確定した文を順に読み上げます。
        Cloud TTS は Gemini と別系統の課金（無料枠100万字）なので連打に注意。
      </p>
      <TtsTestClient />
    </main>
  );
}
