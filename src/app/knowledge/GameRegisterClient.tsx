"use client";

import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";

import { KNOWLEDGE_MAX_URLS } from "@/lib/config";

/** `game.json` に入る値。`slug` は別管理（ディレクトリ名になる）。 */
interface GameFields {
  title: string;
  version: string;
  progressLabel: string;
  progressPlaceholder: string;
  lostLabel: string;
}

const EMPTY_URLS = Array.from({ length: KNOWLEDGE_MAX_URLS }, () => "");
const SLUG_PATTERN = /^[a-z0-9-]+$/;

const INPUT_CLASS =
  "rounded border border-black/15 bg-background px-3 py-2 text-foreground dark:border-white/15";

/**
 * ゲーム登録（ticket 23・§8.4 その0）。
 *
 * ①タイトル・機種・発売時期 → ②参照URL → primer の**下書き**を生成 → **目視確認・手直し**
 * → `knowledge/<slug>/game.json` と `primer.md` を保存。生成物をそのまま信じない道具であって、
 * 自動化ではない。保存は「保存」ボタンでしか起きない。
 */
export default function GameRegisterClient({ existingSlugs }: { existingSlugs: string[] }) {
  const router = useRouter();

  const [title, setTitle] = useState("");
  const [platform, setPlatform] = useState("");
  const [releasedAt, setReleasedAt] = useState("");
  const [urls, setUrls] = useState<string[]>(EMPTY_URLS);

  const [slug, setSlug] = useState("");
  const [fields, setFields] = useState<GameFields | null>(null);
  const [primer, setPrimer] = useState("");

  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [overwrite, setOverwrite] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const setUrlAt = useCallback((i: number, value: string) => {
    setUrls((prev) => prev.map((u, j) => (i === j ? value : u)));
  }, []);

  const setField = useCallback((key: keyof GameFields, value: string) => {
    setFields((prev) => (prev ? { ...prev, [key]: value } : prev));
  }, []);

  const generate = useCallback(async () => {
    setGenerating(true);
    setError(null);
    setSavedMessage(null);
    setFields(null);
    setPrimer("");
    setOverwrite(false);
    try {
      const res = await fetch("/api/knowledge/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          platform: platform.trim(),
          releasedAt: releasedAt.trim(),
          urls: urls.map((u) => u.trim()).filter(Boolean),
        }),
      });
      const data = (await res.json()) as {
        slug?: string;
        game?: GameFields;
        primer?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? `生成に失敗(HTTP ${res.status})`);
      setSlug(data.slug ?? "");
      setFields(
        data.game ?? {
          title: title.trim(),
          version: "",
          progressLabel: "",
          progressPlaceholder: "",
          lostLabel: "",
        },
      );
      setPrimer(data.primer ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }, [title, platform, releasedAt, urls]);

  const save = useCallback(async () => {
    if (!fields) return;
    setSaving(true);
    setError(null);
    setSavedMessage(null);
    try {
      const res = await fetch("/api/knowledge/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "game", game: slug.trim(), ...fields, primer, overwrite }),
      });
      const data = (await res.json()) as { saved?: string[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? `保存に失敗(HTTP ${res.status})`);
      setSavedMessage(
        `knowledge/${slug.trim()}/ に ${data.saved?.join("・") ?? ""} を保存しました。トップから、このゲームの冒険を作れます。`,
      );
      setOverwrite(false);
      router.refresh(); // ゲーム一覧（下の章キャスト表・トップ）に反映する。
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [slug, fields, primer, overwrite, router]);

  const trimmedSlug = slug.trim();
  const slugValid = SLUG_PATTERN.test(trimmedSlug);
  const slugExists = existingSlugs.includes(trimmedSlug);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-black/60 dark:text-white/60">タイトル（必須）</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例: ファイアーエムブレム 暗黒竜と光の剣"
            className={INPUT_CLASS}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-black/60 dark:text-white/60">機種</span>
          <input
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            placeholder="例: ファミコン"
            className={INPUT_CLASS}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-black/60 dark:text-white/60">発売時期</span>
          <input
            value={releasedAt}
            onChange={(e) => setReleasedAt(e.target.value)}
            placeholder="例: 1990年"
            className={INPUT_CLASS}
          />
        </label>
      </div>
      <p className="text-sm text-black/60 dark:text-white/60">
        機種と発売時期は<strong>版を同定するアンカー</strong>です。省くと、後発のリメイク・移植版の
        情報が混ざります。
      </p>

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
              placeholder="https://ja.wikipedia.org/wiki/..."
              className={INPUT_CLASS}
            />
          </label>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={generate}
          disabled={generating || !title.trim() || urls.every((u) => !u.trim())}
          className="rounded bg-foreground px-3 py-1 text-sm text-background disabled:opacity-50"
        >
          {generating ? "取得して生成中…" : "取得して下書きを作る"}
        </button>
        {generating && (
          <span className="text-sm text-black/60 dark:text-white/60">
            参照URLを取得して LLM に問い合わせています。30秒ほどかかります。
          </span>
        )}
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {savedMessage && (
        <p className="text-sm text-green-700 dark:text-green-400">{savedMessage}</p>
      )}

      {fields && (
        <div className="flex flex-col gap-4 border-t border-black/10 pt-4 dark:border-white/10">
          <p className="text-sm text-amber-700 dark:text-amber-400">
            <strong>この下書きをそのまま信じないでください。</strong> LLM は版を取り違えても静かに
            間違えます。<code>⚠️要確認</code> の項目は一次情報で裏取りし、攻略手順が混ざっていないか、
            この版と違う仕様が書かれていないかを確認してから保存してください。
          </p>

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-black/60 dark:text-white/60">
                slug（ディレクトリ名・半角英小文字/数字/ハイフン）
              </span>
              <input
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="fe-fc"
                className={INPUT_CLASS}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-black/60 dark:text-white/60">title</span>
              <input
                value={fields.title}
                onChange={(e) => setField("title", e.target.value)}
                className={INPUT_CLASS}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-black/60 dark:text-white/60">version</span>
              <input
                value={fields.version}
                onChange={(e) => setField("version", e.target.value)}
                placeholder="ファミコン版（1990）"
                className={INPUT_CLASS}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-black/60 dark:text-white/60">
                progressLabel（進捗の呼び方）
              </span>
              <input
                value={fields.progressLabel}
                onChange={(e) => setField("progressLabel", e.target.value)}
                placeholder="到達章"
                className={INPUT_CLASS}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-black/60 dark:text-white/60">progressPlaceholder</span>
              <input
                value={fields.progressPlaceholder}
                onChange={(e) => setField("progressPlaceholder", e.target.value)}
                placeholder="例: 第2章"
                className={INPUT_CLASS}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-black/60 dark:text-white/60">
                lostLabel（空 = ロストの概念が無い）
              </span>
              <input
                value={fields.lostLabel}
                onChange={(e) => setField("lostLabel", e.target.value)}
                placeholder="失った仲間（ロスト）"
                className={INPUT_CLASS}
              />
            </label>
          </div>

          {trimmedSlug !== "" && !slugValid && (
            <p className="text-sm text-red-600 dark:text-red-400">
              slug は半角英小文字・数字・ハイフンだけで指定してください。
            </p>
          )}
          {slugExists && (
            <p className="text-sm text-red-600 dark:text-red-400">
              <strong>knowledge/{trimmedSlug}/ は既にあります。</strong>{" "}
              このまま保存すると、そのゲームの <code>game.json</code> と{" "}
              <code>primer.md</code> を上書きします（<code>knowledgeBuilder</code> や
              章キャスト表の設定も失われます）。
            </p>
          )}

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-black/60 dark:text-white/60">
              primer.md（そのまま保存されます・手直ししてください）
            </span>
            <textarea
              value={primer}
              onChange={(e) => setPrimer(e.target.value)}
              rows={24}
              spellCheck={false}
              className={`${INPUT_CLASS} font-mono text-xs`}
            />
          </label>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={saving || !slugValid || !fields.title.trim() || primer.trim() === ""}
              className="rounded bg-foreground px-3 py-1 text-sm text-background disabled:opacity-50"
            >
              {saving ? "保存中…" : "game.json と primer.md を保存"}
            </button>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={overwrite}
                onChange={(e) => setOverwrite(e.target.checked)}
              />
              <span className={slugExists ? "text-red-600 dark:text-red-400" : ""}>
                既存の knowledge/&lt;slug&gt;/ を上書きする
              </span>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
