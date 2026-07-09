import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { chapterFileName, KNOWLEDGE_DIR } from "@/lib/knowledge";

/**
 * 目視確認した章キャスト表を `knowledge/fe-fc/chapters/` に書き出す（ticket 16）。
 *
 * ファイル名はサーバ側で章番号から組み立てる。クライアントから受け取った文字列を
 * パスに使わない（`../` 等のトラバーサルを構造的に不可能にする）。
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

function parseRequest(body: unknown): SaveChapter[] {
  if (typeof body !== "object" || body === null) {
    throw new SaveError("リクエスト本文が不正です（JSON オブジェクトが必要）。", 400);
  }
  const { chapters } = body as Record<string, unknown>;
  if (!Array.isArray(chapters) || chapters.length === 0) {
    throw new SaveError("chapters（1件以上の配列）が必要です。", 400);
  }
  return chapters.map((c) => {
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
}

export async function POST(req: Request): Promise<Response> {
  try {
    const body = await req.json().catch(() => {
      throw new SaveError("リクエスト本文を JSON として解釈できません。", 400);
    });
    const chapters = parseRequest(body);

    const dir = path.join(KNOWLEDGE_DIR, "chapters");
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
