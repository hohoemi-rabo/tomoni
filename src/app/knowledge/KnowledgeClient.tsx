"use client";

import { useCallback, useState } from "react";

import { KNOWLEDGE_MAX_URLS } from "@/lib/config";

interface Draft {
  chapter: number;
  fileName: string;
  markdown: string;
  exists: boolean;
}

const EMPTY_URLS = Array.from({ length: KNOWLEDGE_MAX_URLS }, () => "");

/** 取得 → 下書き確認 → 選んだ章だけ保存。書き込みは保存ボタンでしか起きない。 */
export default function KnowledgeClient() {
  const [urls, setUrls] = useState<string[]>(EMPTY_URLS);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [failed, setFailed] = useState<number[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const setUrlAt = useCallback((i: number, value: string) => {
    setUrls((prev) => prev.map((u, j) => (i === j ? value : u)));
  }, []);

  const extract = useCallback(async () => {
    setExtracting(true);
    setError(null);
    setSavedMessage(null);
    setDrafts([]);
    setFailed([]);
    try {
      const res = await fetch("/api/knowledge/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: urls.map((u) => u.trim()).filter(Boolean) }),
      });
      const data = (await res.json()) as {
        drafts?: Draft[];
        failed?: number[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? `取得に失敗(HTTP ${res.status})`);
      setDrafts(data.drafts ?? []);
      setFailed(data.failed ?? []);
      // 既定は全章を選択。上書きになる章は明示するが、外すのは利用者に委ねる。
      setSelected(new Set((data.drafts ?? []).map((d) => d.chapter)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExtracting(false);
    }
  }, [urls]);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    setSavedMessage(null);
    try {
      const chapters = drafts
        .filter((d) => selected.has(d.chapter))
        .map((d) => ({ chapter: d.chapter, markdown: d.markdown }));
      if (chapters.length === 0) throw new Error("保存する章を選んでください。");

      const res = await fetch("/api/knowledge/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chapters }),
      });
      const data = (await res.json()) as { saved?: string[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? `保存に失敗(HTTP ${res.status})`);
      setSavedMessage(`${data.saved?.length ?? 0} 章を保存しました。`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [drafts, selected]);

  const toggle = useCallback((chapter: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(chapter)) next.delete(chapter);
      else next.add(chapter);
      return next;
    });
  }, []);

  const overwriteCount = drafts.filter(
    (d) => d.exists && selected.has(d.chapter),
  ).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        {urls.map((url, i) => (
          <label key={i} className="flex flex-col gap-1 text-sm">
            <span className="text-black/60 dark:text-white/60">
              参照URL {i + 1}
              {i === 0 ? "（必須）" : "（任意）"}
            </span>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrlAt(i, e.target.value)}
              placeholder="https://example.com/fe/chart.htm"
              className="rounded border border-black/15 bg-background px-3 py-2 text-foreground dark:border-white/15"
            />
          </label>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={extract}
          disabled={extracting || urls.every((u) => !u.trim())}
          className="rounded bg-foreground px-3 py-1 text-sm text-background disabled:opacity-50"
        >
          {extracting ? "取得して抽出中…" : "取得して下書きを作る"}
        </button>
        {extracting && (
          <span className="text-sm text-black/60 dark:text-white/60">
            章ごとにLLMへ問い合わせています。25章だと2分ほどかかります。
          </span>
        )}
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {failed.length > 0 && (
        <p className="text-sm text-red-600 dark:text-red-400">
          第 {failed.join("・")} 章の抽出に失敗しました。失敗した章で加わる仲間が抜けたまま
          以降の章へ累積されているため、<strong>第 {Math.min(...failed)} 章以降は保存しないでください</strong>。
          それより前の章は正しいので、そこまで保存し、もう一度「取得して下書きを作る」を押して
          残りを取り直してください。
        </p>
      )}
      {savedMessage && (
        <p className="text-sm text-green-700 dark:text-green-400">{savedMessage}</p>
      )}

      {drafts.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-3 border-t border-black/10 pt-4 dark:border-white/10">
            <button
              type="button"
              onClick={save}
              disabled={saving || selected.size === 0}
              className="rounded bg-foreground px-3 py-1 text-sm text-background disabled:opacity-50"
            >
              {saving ? "保存中…" : `選んだ ${selected.size} 章を保存`}
            </button>
            {overwriteCount > 0 && (
              <span className="text-sm text-red-600 dark:text-red-400">
                うち {overwriteCount} 章は既存ファイルを上書きします。
              </span>
            )}
          </div>

          <div className="flex flex-col gap-4">
            {drafts.map((d) => (
              <section key={d.chapter} className="flex flex-col gap-1">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selected.has(d.chapter)}
                    onChange={() => toggle(d.chapter)}
                  />
                  <span className="font-medium">{d.fileName}</span>
                  {d.exists && (
                    <span className="text-red-600 dark:text-red-400">（上書き）</span>
                  )}
                </label>
                <pre className="overflow-x-auto rounded border border-black/15 p-3 text-xs dark:border-white/15">
                  {d.markdown}
                </pre>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
