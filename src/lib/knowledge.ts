import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * 知識ファイルのローダー（REQUIREMENTS §7.2 / §8）。サーバ専用。
 *
 * 攻略データではなく、AIの感情・反応を正しくする前提（プライマー1枚）と、
 * 「今この章に誰がいるか」（該当章のキャスト表1枚だけ）を読む最小リトリーバル。
 * 全章一括注入はしない（トークン肥大を避け、今の章に集中させるため）。
 *
 * パス基点は実行時の `process.cwd()`。ローカル専用前提なので、cwd 直下に
 * `knowledge/fe-fc/` がある状態で動かす。
 */

export const KNOWLEDGE_DIR = path.join(process.cwd(), "knowledge", "fe-fc");

/** 章番号 → キャスト表のファイル名（ASCII・ゼロ埋め2桁）。読み書きで共有する。 */
export function chapterFileName(chapter: number): string {
  return `chapter-${String(chapter).padStart(2, "0")}.md`;
}

/** 全章共通プライマー（システムプロンプト先頭に固定する1枚）。 */
export async function loadPrimer(): Promise<string> {
  return readFile(path.join(KNOWLEDGE_DIR, "fe-primer.md"), "utf8");
}

/** 全角数字→半角に正規化する。 */
function toHalfWidthDigits(s: string): string {
  return s.replace(/[０-９]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0),
  );
}

/**
 * `state.chapter`（例 "第3章" / "第１０章"）から章番号を取り出す。
 * 数字が無い・未指定なら null。
 */
export function chapterToNumber(chapter?: string): number | null {
  if (!chapter) return null;
  const match = toHalfWidthDigits(chapter).match(/\d+/);
  if (!match) return null;
  const n = Number.parseInt(match[0], 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * 現在章のキャスト表を1枚だけ読む。`state.chapter` → ゼロ埋め2桁 →
 * `chapters/chapter-XX.md`。ファイルが無い／章未指定なら null（未注入で続行）。
 * 「存在しない」以外の I/O エラーは握りつぶさず投げる。
 */
export async function loadChapterCast(chapter?: string): Promise<string | null> {
  const num = chapterToNumber(chapter);
  if (num === null) return null;

  try {
    return await readFile(
      path.join(KNOWLEDGE_DIR, "chapters", chapterFileName(num)),
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
