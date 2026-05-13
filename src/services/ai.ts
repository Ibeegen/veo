import { GoogleGenAI } from "@google/genai";
import { AppState, GeneratedResult } from "../types";
import { v4 as uuidv4 } from "uuid";

// ─── ĐỌC TẤT CẢ KEY TỪ VERCEL ENV (hỗ trợ nhiều key xoay vòng) ────────────
// Khai báo trên Vercel Dashboard:
//   VITE_GEMINI_API_KEY   = AIza...  (key 1 - bắt buộc)
//   VITE_GEMINI_API_KEY_2 = AIza...  (key 2 - tuỳ chọn)
//   VITE_GEMINI_API_KEY_3 = AIza...  (key 3 - tuỳ chọn)
// @ts-ignore
const _env = typeof import.meta !== "undefined" && import.meta.env ? import.meta.env : {};

const ALL_KEYS: string[] = [
  _env.VITE_GEMINI_API_KEY,
  _env.VITE_GEMINI_API_KEY_2,
  _env.VITE_GEMINI_API_KEY_3,
].filter((k): k is string => typeof k === "string" && k.startsWith("AIza"));

if (ALL_KEYS.length === 0) {
  console.error("[AI] Không tìm thấy VITE_GEMINI_API_KEY trong Vercel Environment Variables.");
}

let keyIndex = 0;

function getNextKey(): string {
  if (ALL_KEYS.length === 0) {
    throw new Error("Chưa cấu hình VITE_GEMINI_API_KEY trên Vercel. Liên hệ quản trị viên.");
  }
  const key = ALL_KEYS[keyIndex % ALL_KEYS.length];
  keyIndex = (keyIndex + 1) % ALL_KEYS.length;
  return key;
}

async function callWithRetry<T>(fn: (client: GoogleGenAI) => Promise<T>): Promise<T> {
  const maxTries = ALL_KEYS.length || 1;
  let lastError: any;

  for (let i = 0; i < maxTries; i++) {
    const key = getNextKey();
    try {
      const client = new GoogleGenAI({ apiKey: key });
      return await fn(client);
    } catch (err: any) {
      lastError = err;
      const isQuota =
        err?.status === 429 ||
        String(err?.message).includes("429") ||
        String(err?.message).includes("quota");
      if (isQuota && i < maxTries - 1) {
        console.warn(`[AI] Key ${i + 1} hết quota, thử key tiếp theo...`);
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

interface AIResponse {
  hook: string;
  hashtags: string[];
  scenes: Array<{ videoPrompt: string; voiceScript: string }>;
  thumbnailTexts: string[];
}

export async function suggestScripts(contentSnippet: string): Promise<string[]> {
  if (!contentSnippet || contentSnippet.trim().split(/\s+/).length < 4) return [];

  const prompt = `Dựa trên nội dung sau, đề xuất 3 tiêu đề viral ngắn gọn cho video TikTok/Reels xây dựng thương hiệu cá nhân.
Yêu cầu: Mỗi tiêu đề tối đa 20 từ, tiếng Việt, kích thích tò mò, KHÔNG vượt quá 20 từ.
Nội dung: "${contentSnippet}"
Trả về CHỈ một mảng JSON gồm 3 chuỗi string. Không thêm markdown.`;

  const result = await callWithRetry(ai =>
    ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: { responseMimeType: "application/json" },
    })
  );

  if (result.text) {
    const data = JSON.parse(result.text);
    if (Array.isArray(data)) return data.slice(0, 3);
  }
  return [];
}

export async function generateContent(state: AppState): Promise<GeneratedResult> {
  const modelTimeLimit = state.videoModel === "Veo 3" ? 8 : 10;

  const prompt = `You are an expert personal branding and short-video viral scriptwriter (TikTok/Reels/Shorts).

USER INPUT:
- Content/Topic: "${state.content}"
- Advanced Notes/Style: "${state.notes}"
- Number of Scenes: ${state.sceneCount}
- Voice Accent: ${state.voice}
- Video Duration per Scene Limit: ${modelTimeLimit} seconds.

RULES FOR VIDEO PROMPTS:
1. NO text or typography on the video.
2. NO scene transitions within a single prompt.
3. Maintain 100% reference character consistency.
4. Actions and expressions must be realistic, natural, like a real human.
5. Consistent face, lighting, and style throughout all scenes.
6. Write video prompts in English.

RULES FOR VOICE SCRIPT:
1. Written in Vietnamese.
2. Must sound completely natural.
3. ${modelTimeLimit === 8 ? "MUST be between 20-24 words per scene." : "MUST be between 24-28 words per scene."}
4. Count words internally before generating. Do not exceed the limits.
5. Use human-like phrasing optimized for Vietnamese voice.
6. Tone should match the Advanced Notes.

RULES FOR HOOK & HASHTAGS:
1. 1 Viral, high-retention hook (Vietnamese).
2. 5 relevant hashtags (starting with #).

RULES FOR THUMBNAIL TEXTS:
1. 3 biến thể tiêu đề thumbnail, tối đa 80 ký tự mỗi cái.
2. Ngắn gọn, viral, dễ đọc trên mobile, tiếng Việt.

OUTPUT FORMAT (JSON ONLY):
{
  "hook": "string",
  "hashtags": ["#tag1", "#tag2", "#tag3", "#tag4", "#tag5"],
  "scenes": [{ "videoPrompt": "English...", "voiceScript": "Vietnamese..." }],
  "thumbnailTexts": ["Variant 1", "Variant 2", "Variant 3"]
}

Ensure exactly ${state.sceneCount} items in "scenes". Return valid JSON only.`;

  const response = await callWithRetry(ai =>
    ai.models.generateContent({
      model: "gemini-2.5-pro",
      contents: prompt,
      config: { responseMimeType: "application/json" },
    })
  );

  if (!response.text) throw new Error("AI không trả về kết quả. Vui lòng thử lại.");

  const data = JSON.parse(response.text) as AIResponse;

  const thumbnailStyles = [
    "bg-black/70 backdrop-blur-md text-white rounded-[16px] px-5 py-3 shadow-[0_8px_30px_rgb(0,0,0,0.5)] border border-white/20 font-title font-bold uppercase tracking-tight",
    "bg-white/25 backdrop-blur-xl border border-white/50 text-white shadow-[0_8px_32px_0_rgba(0,0,0,0.6)] rounded-[20px] px-5 py-3 font-title font-extrabold uppercase drop-shadow-md tracking-tight",
    "bg-gradient-to-r from-[#9333EA] to-[#C026D3] text-white shadow-[0_10px_30px_rgba(192,38,211,0.5)] rounded-[14px] px-5 py-3 border border-white/20 font-title font-extrabold uppercase tracking-tight",
    "bg-gradient-to-r from-[#F5A623] to-[#EA580C] text-white shadow-[0_10px_30px_rgba(245,166,35,0.4)] rounded-[16px] px-5 py-3 border border-white/30 font-title font-extrabold uppercase tracking-tight",
    "bg-[#FDE68A] text-[#92400E] shadow-[0_8px_30px_rgba(245,166,35,0.4)] px-6 py-3 rounded-[12px] border-2 border-[#F5A623] font-title font-extrabold uppercase tracking-tight",
    "bg-[#0EA5E9] text-white shadow-[0_8px_30px_rgba(14,165,233,0.5)] px-5 py-3 rounded-[16px] border border-white/20 font-title font-extrabold uppercase tracking-tight",
  ];

  const shuffledStyles = [...thumbnailStyles].sort(() => 0.5 - Math.random());

  return {
    id: uuidv4(),
    timestamp: Date.now(),
    hook: data.hook,
    hashtags: data.hashtags,
    scenes: data.scenes,
    thumbnailVariations: data.thumbnailTexts.map((text, i) => ({
      text,
      styleClass: shuffledStyles[i % shuffledStyles.length],
    })),
    inputs: state,
  };
}
