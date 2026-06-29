import "server-only";

import {
  GoogleGenAI,
  HarmBlockThreshold,
  HarmCategory,
  type SafetySetting,
} from "@google/genai";

import { getGeminiApiKey } from "@/lib/env";

/**
 * サーバ専用の Google Gen AI クライアント（REQUIREMENTS §6.1）。
 *
 * - APIキーはサーバ専用（`NEXT_PUBLIC_` を付けない）。クライアントから import しない。
 * - env を読むのは初回生成時のみ（遅延生成）。トップレベルで呼ばないこと
 *   ——ビルド時に env 検証を走らせないため（supabase.ts と同じ方針）。
 * - 実況（07）と任意の state 更新（12）の双方から再利用する。
 */
let client: GoogleGenAI | undefined;

export function getGeminiClient(): GoogleGenAI {
  if (!client) {
    client = new GoogleGenAI({ apiKey: getGeminiApiKey() });
  }
  return client;
}

/**
 * 全カテゴリ `BLOCK_NONE` の安全設定（REQUIREMENTS §6.1）。
 *
 * 戦闘・戦死などゲーム内容で空応答にならないようにブロックを外す。題材は
 * ゲーム実況であり、攻撃的な利用ではない（最小権限の例外を明示）。
 */
export const SAFETY_SETTINGS_BLOCK_NONE: SafetySetting[] = [
  HarmCategory.HARM_CATEGORY_HATE_SPEECH,
  HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
  HarmCategory.HARM_CATEGORY_HARASSMENT,
  HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
].map((category) => ({
  category,
  threshold: HarmBlockThreshold.BLOCK_NONE,
}));
