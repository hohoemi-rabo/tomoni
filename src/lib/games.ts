import "server-only";

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { GameDef } from "@/lib/types";

/**
 * ゲーム定義のローダー（REQUIREMENTS §8.0・ticket 20）。サーバ専用。
 *
 * ゲーム1本＝ディレクトリ1つ（`knowledge/<slug>/game.json`）。**ファイルを置くだけで
 * ゲームが増える**——ゲームを足すためにコードを書かない。ゲーム固有の分岐を `src/` に
 * 散らかさないこと（分岐したくなったら、それは game.json か primer.md に置けるはず）。
 *
 * ここが持つのは「どう呼ぶか」と「どう引くか」だけ。AIの振る舞いは prompt.ts、
 * そのゲームの前提は primer.md（§7.3 の2層）。
 */

export const KNOWLEDGE_ROOT = path.join(process.cwd(), "knowledge");

/** ディレクトリ名として安全な slug だけを通す（パストラバーサル封じ）。 */
const SLUG_PATTERN = /^[a-z0-9-]+$/;

export function isValidGameSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug);
}

/**
 * slug から知識ディレクトリの絶対パスを組む。**検証を通らない slug は投げる**。
 * `path.join` にクライアント由来の文字列をそのまま渡さないための唯一の入口。
 */
export function gameDir(slug: string): string {
  if (!isValidGameSlug(slug)) {
    throw new Error(`ゲームslugが不正です: ${slug}`);
  }
  return path.join(KNOWLEDGE_ROOT, slug);
}

/** `game.json` を読む。無ければ null（呼び出し側が「未登録のゲーム」として扱う）。 */
export async function loadGameDef(slug: string): Promise<GameDef | null> {
  let raw: string;
  try {
    raw = await readFile(path.join(gameDir(slug), "game.json"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }

  const parsed = JSON.parse(raw) as Partial<GameDef>;
  if (!parsed.title?.trim()) {
    throw new Error(`game.json に title がありません: ${slug}`);
  }
  return { ...parsed, slug, title: parsed.title } as GameDef;
}

/**
 * `knowledge/` 配下のゲーム定義を全部読む（新規作成フォームの選択肢・§10）。
 * `game.json` が無いディレクトリは無視する。slug 順で安定させる。
 */
export async function listGames(): Promise<GameDef[]> {
  const entries = await readdir(KNOWLEDGE_ROOT, { withFileTypes: true });
  const slugs = entries
    .filter((e) => e.isDirectory() && isValidGameSlug(e.name))
    .map((e) => e.name)
    .sort();

  const defs = await Promise.all(slugs.map((slug) => loadGameDef(slug)));
  return defs.filter((d): d is GameDef => d !== null);
}
