import { GoogleGenAI } from "@google/genai";
import { AppState, GeneratedResult, ScriptScene, ThumbnailVariation } from "../types";
import { v4 as uuidv4 } from "uuid";

// Initialize AI explicitly avoiding the auto-check for environment variables if unavailable
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error("GEMINI_API_KEY is not defined.");
}
const ai = new GoogleGenAI({ apiKey: apiKey || "" });

interface AIResponse {
  hook: string;
  hashtags: string[];
  scenes: ScriptScene[];
  thumbnailTexts: string[];
}

export async function suggestScripts(contentSnippet: string): Promise<string[]> {
  if (!contentSnippet || contentSnippet.trim().split(/\s+/).length < 4) return [];

  const prompt = `Dựa trên đoạn nội dung sau cho một video ngắn xây dựng thương hiệu cá nhân, hãy đề xuất 3 hướng đi/kịch bản (angles/directions) sâu sắc và hấp dẫn. Mỗi gợi ý dài khoảng 30 đến 35 từ (tối đa 35 từ) và phải được viết bằng TIẾNG VIỆT.
Nội dung của người dùng: "${contentSnippet}"
Trả về CHỈ một mảng JSON hợp lệ gồm 3 chuỗi string. Không thêm markdown hay văn bản nào khác ngoài JSON.`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      },
    });

    if (response.text) {
      const data = JSON.parse(response.text);
      if (Array.isArray(data)) return data.slice(0, 3);
    }
    return [];
  } catch (error) {
    console.error("AI Suggestion error:", error);
    return [];
  }
}

export async function generateContent(state: AppState): Promise<GeneratedResult> {
  const modelTimeLimit = state.videoModel === "Veo 3" ? 8 : 10;
  
  const prompt = `You are an expert personal branding and short-video viral scriptwriter (TikTok/Reels/Shorts).
Your task is to generate a complete script and video prompts based on the user's input.

USER INPUT:
- Content/Topic: "${state.content}"
- Advanced Notes/Style: "${state.notes}"
- Number of Scenes: ${state.sceneCount}
- Voice Accent: ${state.voice}
- Video Duration per Scene Limit: ${modelTimeLimit} seconds.

RULES FOR VIDEO PROMPTS:
1. NO text or typography on the video.
2. NO scene transitions within a single prompt.
3. NO changing the character. Maintain 100% reference character consistency.
4. Actions and expressions must be realistic, natural, like a real human.
5. Consistent face, lighting, and style throughout all scenes.
6. Write video prompts in English.

RULES FOR VOICE SCRIPT (Lời thoại):
1. Written in Vietnamese.
2. Must sound completely natural, like a real person talking to the camera.
3. ${modelTimeLimit === 8 ? "For 8s limit, the script MUST be between 20-24 words per scene. Natural pacing, not too fast, not cramped." : "For 10s limit, the script MUST be between 24-28 words per scene. Maintain natural pacing, easy to understand, emotional."}
4. MANDATORY: You MUST count the words for each voiceScript internally before generating. Do not exceed the limits.
5. Do not create overly long sentences that are hard to read. Use human-like phrasing. Optimize for a natural Vietnamese voice.
6. Tone should match the Advanced Notes requested by the user.

RULES FOR HOOK & HASHTAGS:
1. 1 Viral, high-retention hook (Vietnamese).
2. 5 relevant hashtags (starting with #).

RULES FOR THUMBNAIL TEXTS:
1. Tạo 3 biến thể tiêu đề để đặt lên ảnh thumbnail.
2. Tối đa 80 ký tự cho mỗi tiêu đề.
3. Ưu tiên: Ngắn gọn, viral, dễ đọc trên mobile, tạo cảm giác tò mò, phù hợp thumbnail TikTok/Reels/Shorts.
4. Viết bằng tiếng Việt.

OUTPUT FORMAT (JSON ONLY):
{
  "hook": "string",
  "hashtags": ["#tag1", "#tag2", "#tag3", "#tag4", "#tag5"],
  "scenes": [
    {
      "videoPrompt": "English prompt describing the visual action...",
      "voiceScript": "Vietnamese dialogue..."
    }
  ],
  "thumbnailTexts": ["Variant 1", "Variant 2", "Variant 3"]
}

Ensure there are exactly ${state.sceneCount} items in the "scenes" array.
Return valid JSON only.`;

  const response = await ai.models.generateContent({
    model: "gemini-2.5-pro",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
    },
  });

  if (!response.text) {
    throw new Error("Failed to generate content from AI");
  }

  const data = JSON.parse(response.text) as AIResponse;

  const thumbnailStyles = [
    "bg-black/70 backdrop-blur-md text-white rounded-[16px] px-5 py-3 shadow-[0_8px_30px_rgb(0,0,0,0.5)] border border-white/20 font-title font-bold uppercase tracking-tight",
    "bg-white/25 backdrop-blur-xl border border-white/50 text-white shadow-[0_8px_32px_0_rgba(0,0,0,0.6)] rounded-[20px] px-5 py-3 font-title font-extrabold uppercase drop-shadow-md tracking-tight",
    "bg-gradient-to-r from-[#9333EA] to-[#C026D3] text-white shadow-[0_10px_30px_rgba(192,38,211,0.5)] rounded-[14px] px-5 py-3 border border-white/20 font-title font-extrabold uppercase tracking-tight",
    "bg-gradient-to-r from-[#F5A623] to-[#EA580C] text-white shadow-[0_10px_30px_rgba(245,166,35,0.4)] rounded-[16px] px-5 py-3 border border-white/30 font-title font-extrabold uppercase tracking-tight",
    "bg-[#FDE68A] text-[#92400E] shadow-[0_8px_30px_rgba(245,166,35,0.4)] px-6 py-3 rounded-[12px] border-2 border-[#F5A623] font-title font-extrabold uppercase tracking-tight",
    "bg-[#0EA5E9] text-white shadow-[0_8px_30px_rgba(14,165,233,0.5)] px-5 py-3 rounded-[16px] border border-white/20 font-title font-extrabold uppercase tracking-tight"
  ];

  // Randomize the styles
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
