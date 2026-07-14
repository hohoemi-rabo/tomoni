import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { gameDir, isValidGameSlug, loadGameDef } from "@/lib/games";
import { chapterFileName } from "@/lib/knowledge";
import type { GameDef } from "@/lib/types";

/**
 * 目視確認した知識ファイルを `knowledge/<game>/` に書き出す（ticket 16 / 21 / 23）。
 *
 * **リポジトリで唯一 `writeFile` を持つファイル。** パスは必ずサーバ側で組み立てる——
 * ゲームslug は `gameDir` が `[a-z0-9-]+` で検証し、ファイル名は章番号／固定名から作る。
 * クライアントから受け取った文字列をそのままパスに使わない（`../` 等のトラバーサルを
 * 構造的に不可能にする）。
 *
 * 2種類の書き込みを `kind` で分ける:
 * - `chapters` … 章キャスト表。**実在するゲームにしか書かない**（ゴミのディレクトリを作らせない）。
 * - `game` … ゲーム登録（`game.json` ＋ `primer.md`）。こちらは**新しいディレクトリを作る側**なので
 *   存在チェックは逆向き——既にあれば `overwrite` を要求して止める（`fe-fc` を事故で潰さない）。
 */

class SaveError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "SaveError";
  }
}

interface SaveChapter {
  chapter: number;
  markdown: string;
}

interface ChaptersRequest {
  kind: "chapters";
  game: string;
  chapters: SaveChapter[];
}

interface GameRequest {
  kind: "game";
  game: string;
  /** `game.json` に入る値。空文字は省略する（`lostLabel` の省略＝その概念が無い・§8.0）。 */
  fields: Omit<GameDef, "slug" | "knowledgeBuilder">;
  primer: string;
  overwrite: boolean;
}

type SaveRequest = ChaptersRequest | GameRequest;

function requireSlug(raw: unknown): string {
  if (typeof raw !== "string" || !isValidGameSlug(raw)) {
    throw new SaveError("game（ゲームslug）が不正です。半角英小文字・数字・ハイフンのみ。", 400);
  }
  return raw;
}

/** 任意の文字列フィールド。空文字は「無し」として扱い、`game.json` から落とす。 */
function optionalString(raw: unknown, name: string): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string") {
    throw new SaveError(`${name} は文字列で指定してください。`, 400);
  }
  const trimmed = raw.trim();
  return trimmed === "" ? undefined : trimmed;
}

function parseRequest(body: unknown): SaveRequest {
  if (typeof body !== "object" || body === null) {
    throw new SaveError("リクエスト本文が不正です（JSON オブジェクトが必要）。", 400);
  }
  const b = body as Record<string, unknown>;
  const game = requireSlug(b.game);

  if (b.kind === "game") {
    const title = optionalString(b.title, "title");
    if (!title) throw new SaveError("title（ゲームのタイトル）が必要です。", 400);
    if (typeof b.primer !== "string" || b.primer.trim() === "") {
      throw new SaveError("primer（非空の文字列）が必要です。", 400);
    }
    return {
      kind: "game",
      game,
      fields: {
        title,
        version: optionalString(b.version, "version"),
        progressLabel: optionalString(b.progressLabel, "progressLabel"),
        progressPlaceholder: optionalString(b.progressPlaceholder, "progressPlaceholder"),
        lostLabel: optionalString(b.lostLabel, "lostLabel"),
      },
      primer: b.primer,
      overwrite: b.overwrite === true,
    };
  }

  if (b.kind !== undefined && b.kind !== "chapters") {
    throw new SaveError(`kind が不正です: ${String(b.kind)}`, 400);
  }

  const { chapters } = b;
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
  return { kind: "chapters", game, chapters: parsed };
}

async function exists(dir: string): Promise<boolean> {
  try {
    await access(dir);
    return true;
  } catch {
    return false;
  }
}

/** 章キャスト表を書く（ticket 16 / 21）。 */
async function saveChapters(req: ChaptersRequest): Promise<string[]> {
  // 実在するゲームにだけ書く（未登録の slug で新しいディレクトリを作らせない）。
  if (!(await loadGameDef(req.game))) {
    throw new SaveError(`ゲーム定義が見つかりません: ${req.game}`, 404);
  }

  const dir = path.join(gameDir(req.game), "chapters");
  await mkdir(dir, { recursive: true });

  const saved: string[] = [];
  for (const { chapter, markdown } of req.chapters) {
    const fileName = chapterFileName(chapter);
    await writeFile(path.join(dir, fileName), markdown, "utf8");
    saved.push(fileName);
  }
  return saved;
}

/**
 * ゲームを登録する（ticket 23）。`game.json` は**サーバ側で組み立てる**——
 * クライアントの JSON をそのまま書くと、壊れた定義や `knowledgeBuilder` の混入を受け入れてしまう。
 * 抽出設定は必要なゲームだけ後から手で足す（§8.4 その0）。
 */
async function saveGame(req: GameRequest): Promise<string[]> {
  const dir = gameDir(req.game);

  if ((await exists(dir)) && !req.overwrite) {
    throw new SaveError(
      `既に knowledge/${req.game}/ があります。上書きしてよければ「上書きする」を選んでやり直してください。`,
      409,
    );
  }

  // キー順を固定して読みやすく保つ（値が undefined のキーは JSON.stringify が落とす）。
  const gameJson = {
    title: req.fields.title,
    version: req.fields.version,
    progressLabel: req.fields.progressLabel,
    progressPlaceholder: req.fields.progressPlaceholder,
    lostLabel: req.fields.lostLabel,
  };

  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "game.json"), `${JSON.stringify(gameJson, null, 2)}\n`, "utf8");
  await writeFile(path.join(dir, "primer.md"), req.primer, "utf8");
  return ["game.json", "primer.md"];
}

export async function POST(req: Request): Promise<Response> {
  try {
    const body = await req.json().catch(() => {
      throw new SaveError("リクエスト本文を JSON として解釈できません。", 400);
    });
    const parsed = parseRequest(body);
    const saved =
      parsed.kind === "game" ? await saveGame(parsed) : await saveChapters(parsed);

    return Response.json({ saved }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error instanceof SaveError ? error.status : 500;
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status });
  }
}
