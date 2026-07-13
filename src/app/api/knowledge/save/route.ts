import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { gameDir, isValidGameSlug, loadGameDef } from "@/lib/games";
import { chapterFileName } from "@/lib/knowledge";

/**
 * 目視確認した章キャスト表を `knowledge/<game>/chapters/` に書き出す（ticket 16 / 21）。
 *
 * **リポジトリで唯一 `writeFile` を持つファイル。** パスは必ずサーバ側で組み立てる——
 * ゲームslug は `gameDir` が `[a-z0-9-]+` で検証し、ファイル名は章番号から作る。クライアントから
 * 受け取った文字列をそのままパスに使わない（`../` 等のトラバーサルを構造的に不可能にする）。
 * 実在しないゲームへの書き込みも弾く（`knowledge/` にゴミのディレクトリを作らせない）。
 */

interface SaveChapter {
  chapter: number;
  markdown: string;
}

class SaveError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "SaveError";
  }
}

function parseRequest(body: unknown): { game: string; chapters: SaveChapter[] } {
  if (typeof body !== "object" || body === null) {
    throw new SaveError("リクエスト本文が不正です（JSON オブジェクトが必要）。", 400);
  }
  const { game, chapters } = body as Record<string, unknown>;
  if (typeof game !== "string" || !isValidGameSlug(game)) {
    throw new SaveError("game（ゲームslug）が不正です。", 400);
  }
  if (!Array.isArray(chapters) || chapters.length === 0) {
    throw new SaveError("chapters（1件以上の配列）が必要です。", 400);
  }
  const parsed = chapters.map((c) => {
    if (typeof c !== "object" || c === null) {
      throw new SaveError("chapters の要素はオブジェクトで指定してください。", 400);
    }
    const { chapter, markdown } = c as Record<string, unknown>;
    if (
      typeof chapter !== "number" ||
      !Number.isInteger(chapter) ||
      chapter < 1 ||
      chapter > 99
    ) {
      throw new SaveError("chapter は 1〜99 の整数で指定してください。", 400);
    }
    if (typeof markdown !== "string" || markdown.trim() === "") {
      throw new SaveError("markdown（非空の文字列）が必要です。", 400);
    }
    return { chapter, markdown };
  });
  return { game, chapters: parsed };
}

export async function POST(req: Request): Promise<Response> {
  try {
    const body = await req.json().catch(() => {
      throw new SaveError("リクエスト本文を JSON として解釈できません。", 400);
    });
    const { game, chapters } = parseRequest(body);

    // 実在するゲームにだけ書く（未登録の slug で新しいディレクトリを作らせない）。
    if (!(await loadGameDef(game))) {
      throw new SaveError(`ゲーム定義が見つかりません: ${game}`, 404);
    }

    const dir = path.join(gameDir(game), "chapters");
    await mkdir(dir, { recursive: true });

    const saved: string[] = [];
    for (const { chapter, markdown } of chapters) {
      const fileName = chapterFileName(chapter);
      await writeFile(path.join(dir, fileName), markdown, "utf8");
      saved.push(fileName);
    }

    return Response.json({ saved }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof SaveError ? error.status : 500;
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status });
  }
}
