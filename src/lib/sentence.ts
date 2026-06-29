/**
 * ストリーミング受信テキストの文末分割（REQUIREMENTS §7.1 / ticket 08）。
 *
 * 実況テキストはチャンクで届くため、「文末が確定した文」だけを取り出して TTS の
 * 再生キューへ流す。SDK/DOM 非依存の純関数で、単体検証しやすくしておく。
 */

/** 文末とみなす記号（読点「、」では切らない）。 */
const SENTENCE_ENDERS = "。．！？!?";
/** 文末記号の直後に続けて文に含めてよい閉じ括弧など。 */
const TRAILING_CLOSERS = "」』）)”\"";

/**
 * `buffer` から文末で確定した文を順に切り出し、未確定の残り（`rest`）を返す。
 *
 * - 文末記号（`SENTENCE_ENDERS`）を終端に含めて切る。直後の閉じ括弧も巻き取る。
 * - 改行も文の区切りとして扱う（改行自体は文に含めない）。
 * - 空白だけの断片は捨てる（`sentences` には入れない）。
 * - 文末が見つからない末尾は確定させず `rest` に残す（次のチャンクで続く想定）。
 */
export function takeSentences(buffer: string): {
  sentences: string[];
  rest: string;
} {
  const sentences: string[] = [];
  let start = 0; // 現在の文の開始位置。
  let i = 0;

  while (i < buffer.length) {
    const ch = buffer[i];

    // 改行は区切り。改行自体は含めず、その前までを1文として確定する。
    if (ch === "\n") {
      pushTrimmed(sentences, buffer.slice(start, i));
      i += 1;
      start = i;
      continue;
    }

    if (SENTENCE_ENDERS.includes(ch)) {
      // 文末記号の連続（例「！？」）と直後の閉じ括弧まで巻き取る。
      let end = i + 1;
      while (end < buffer.length && SENTENCE_ENDERS.includes(buffer[end])) {
        end += 1;
      }
      while (end < buffer.length && TRAILING_CLOSERS.includes(buffer[end])) {
        end += 1;
      }
      pushTrimmed(sentences, buffer.slice(start, end));
      i = end;
      start = end;
      continue;
    }

    i += 1;
  }

  return { sentences, rest: buffer.slice(start) };
}

/** 前後の空白を落として非空なら push する。 */
function pushTrimmed(out: string[], raw: string): void {
  const s = raw.trim();
  if (s) out.push(s);
}
