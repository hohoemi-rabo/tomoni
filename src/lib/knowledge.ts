import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import { gameDir } from "@/lib/games";

/**
 * 知識ファイルのローダー（REQUIREMENTS §7.2 / §8）。サーバ専用。
 *
 * 攻略データではなく、AIの感情・反応を正しくする前提（プライマー1枚）と、
 * 「今この章に誰がいるか」（該当章のキャスト表1枚だけ）を読む最小リトリーバル。
 * 全章一括注入はしない（トークン肥大を避け、今の章に集中させるため）。
 *
 * **どのゲームを読むかは呼び出し側が渡す**（`playthroughs.game` → `knowledge/<game>/`・
 * ticket 20）。パスの組み立てと slug の検証は `games.ts` の `gameDir` に集約する。
 */

/** 章番号 → キャスト表のファイル名（ASCII・ゼロ埋め2桁）。読み書きで共有する。 */
export function chapterFileName(chapter: number): string {
  return `chapter-${String(chapter).padStart(2, "0")}.md`;
}

/** 全角数字→半角に正規化する。 */
function toHalfWidthDigits(s: string): string {
  return s.replace(/[０-９]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0),
  );
}

/**
 * `state.chapter`（例 "第3章" / "第１０章"）から章番号を取り出す。
 * 数字が無い・未指定なら null（＝章キャスト表は引かない）。章という単位を持たない
 * ゲームでは、ここが常に null になるだけで実況は成立する。
 */
export function chapterToNumber(chapter?: string): number | null {
  if (!chapter) return null;
  const match = toHalfWidthDigits(chapter).match(/\d+/);
  if (!match) return null;
  const n = Number.parseInt(match[0], 10);
  return Number.isFinite(n) ? n : null;
}

/** 全章共通プライマー（システムプロンプト先頭に固定する1枚）。 */
export async function loadPrimer(game: string): Promise<string> {
  return readFile(path.join(gameDir(game), "primer.md"), "utf8");
}

/**
 * 現在章のキャスト表を1枚だけ読む。`state.chapter` → ゼロ埋め2桁 →
 * `chapters/chapter-XX.md`。ファイルが無い／章未指定なら null（未注入で続行）。
 * 「存在しない」以外の I/O エラーは握りつぶさず投げる。
 */
export async function loadChapterCast(
  game: string,
  chapter?: string,
): Promise<string | null> {
  const num = chapterToNumber(chapter);
  if (num === null) return null;

  try {
    return await readFile(
      path.join(gameDir(game), "chapters", chapterFileName(num)),
      "utf8",
    );
  } catch (error) {
    if (
      error instanceof Error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return null; // 未作成の章は未注入で続行する。
    }
    throw error;
  }
}
