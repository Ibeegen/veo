import { GoogleGenAI } from "@google/genai";
import { AppState, GeneratedResult } from "../types";
import { v4 as uuidv4 } from "uuid";

// ─── ENV KEYS (Vercel Dashboard) ─────────────────────────────────────────────
// VITE_GEMINI_API_KEY      AIza...   (Gemini - ưu tiên 1, hỗ trợ vision)
// VITE_GEMINI_API_KEY_2    AIza...   (Gemini key 2 - tuỳ chọn)
// VITE_DEEPSEEK_API_KEY    sk-...    (DeepSeek - dự phòng text, không có vision)
// VITE_OPENAI_API_KEY      sk-...    (OpenAI gpt-4o-mini - dự phòng, có vision)
// @ts-ignore
const E = typeof import.meta !== "undefined" && import.meta.env ? import.meta.env : {};

const GEMINI_KEYS  = [
  E.VITE_GEMINI_API_KEY,
  E.VITE_GEMINI_API_KEY_2,
  E.VITE_GEMINI_API_KEY_3,
  E.VITE_GEMINI_API_KEY_4,
  E.VITE_GEMINI_API_KEY_5,
].filter((k): k is string => typeof k === "string" && k.startsWith("AIza"));
const DEEPSEEK_KEY = E.VITE_DEEPSEEK_API_KEY  as string | undefined;
const OPENAI_KEY   = E.VITE_OPENAI_API_KEY    as string | undefined;

// ─── UTILS ───────────────────────────────────────────────────────────────────
const isQuotaError = (err: any): boolean =>
  err?.status === 429 ||
  String(err?.message).includes("429") ||
  String(err?.message).includes("quota") ||
  String(err?.message).includes("rate_limit");

/** Tách base64 và mimeType từ data URL */
function parseDataUrl(dataUrl: string): { mimeType: string; base64: string } | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], base64: match[2] };
}

// ─── GEMINI CALLER ───────────────────────────────────────────────────────────
async function callGeminiText(model: string, prompt: string): Promise<string> {
  let lastErr: any;
  for (const key of GEMINI_KEYS) {
    try {
      const ai = new GoogleGenAI({ apiKey: key });
      const res = await ai.models.generateContent({
        model,
        contents: prompt,
        config: { responseMimeType: "application/json" },
      });
      if (res.text) return res.text;
      throw new Error("Empty response");
    } catch (err: any) {
      lastErr = err;
      if (isQuotaError(err)) { console.warn("[AI] Gemini key hết quota → thử key tiếp"); continue; }
      throw err;
    }
  }
  throw lastErr;
}

/** Gọi Gemini với ảnh (multimodal) + JSON output */
async function callGeminiVision(
  model: string,
  imageDataUrl: string,
  prompt: string
): Promise<string> {
  const parsed = parseDataUrl(imageDataUrl);
  if (!parsed) throw new Error("Ảnh không hợp lệ");

  let lastErr: any;
  for (const key of GEMINI_KEYS) {
    try {
      const ai = new GoogleGenAI({ apiKey: key });
      const res = await ai.models.generateContent({
        model,
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType: parsed.mimeType as any, data: parsed.base64 } },
              { text: prompt },
            ],
          },
        ],
        config: { responseMimeType: "application/json" },
      });
      if (res.text) return res.text;
      throw new Error("Empty response");
    } catch (err: any) {
      lastErr = err;
      if (isQuotaError(err)) { console.warn("[AI] Gemini vision key hết quota → thử tiếp"); continue; }
      throw err;
    }
  }
  throw lastErr;
}

// ─── OPENAI / DEEPSEEK CALLER ────────────────────────────────────────────────
async function callOpenAICompat(
  endpoint: string,
  apiKey: string,
  model: string,
  messages: any[]
): Promise<string> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, messages, response_format: { type: "json_object" }, temperature: 0.7 }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err: any = new Error(body?.error?.message || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

/** OpenAI vision: gpt-4o-mini hỗ trợ image */
async function callOpenAIVision(imageDataUrl: string, prompt: string): Promise<string> {
  if (!OPENAI_KEY) throw new Error("Không có OPENAI key");
  return callOpenAICompat(
    "https://api.openai.com/v1/chat/completions",
    OPENAI_KEY,
    "gpt-4o-mini",
    [
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: imageDataUrl, detail: "high" } },
          { type: "text", text: prompt },
        ],
      },
    ]
  );
}

// ─── BƯỚC 1: PHÂN TÍCH ẢNH THAM CHIẾU ───────────────────────────────────────
/**
 * Gemini/OpenAI vision phân tích ảnh → trả về JSON mô tả chi tiết
 * Dùng cho: nhân vật, trang phục, bối cảnh, màu sắc, phong cách, cảm xúc, đạo cụ, thương hiệu
 */
async function analyzeReferenceImage(imageDataUrl: string): Promise<ImageAnalysis> {
  const prompt = `Phân tích chi tiết hình ảnh này để dùng làm ảnh tham chiếu cho video ngắn TikTok/Reels.
Trả về JSON với cấu trúc sau (không thêm text ngoài JSON):
{
  "character": "Mô tả nhân vật chính: giới tính, độ tuổi ước tính, ngoại hình nổi bật",
  "outfit": "Trang phục chi tiết: màu sắc, kiểu dáng, phụ kiện",
  "background": "Bối cảnh/môi trường phía sau: trong nhà/ngoài trời, địa điểm, không gian",
  "lighting": "Ánh sáng: tự nhiên/nhân tạo, hướng sáng, màu sắc ánh sáng",
  "colorPalette": "Bảng màu chủ đạo của toàn bộ hình ảnh",
  "cameraAngle": "Góc quay: close-up/medium/wide, góc nhìn từ trên/ngang/dưới",
  "style": "Phong cách tổng thể: professional/casual/luxury/minimalist/creative...",
  "emotion": "Cảm xúc/biểu cảm của nhân vật nếu có",
  "props": "Đạo cụ hoặc vật dụng xuất hiện trong ảnh",
  "brand": "Thương hiệu, logo, text hoặc sản phẩm nhận diện được nếu có",
  "videoDirections": "3 gợi ý góc quay/hành động cho video dựa trên phong cách ảnh này"
}`;

  // Thử Gemini vision trước
  if (GEMINI_KEYS.length > 0) {
    try {
      const text = await callGeminiVision("gemini-2.5-flash", imageDataUrl, prompt);
      return JSON.parse(text) as ImageAnalysis;
    } catch (err) {
      if (isQuotaError(err)) {
        console.warn("[AI] Gemini vision hết quota → thử OpenAI vision");
      } else {
        console.error("[AI] Gemini vision lỗi:", err);
      }
    }
  }

  // Fallback: OpenAI vision (gpt-4o-mini có vision)
  if (OPENAI_KEY) {
    try {
      const text = await callOpenAIVision(imageDataUrl, prompt);
      return JSON.parse(text) as ImageAnalysis;
    } catch (err) {
      console.error("[AI] OpenAI vision lỗi:", err);
    }
  }

  // Không có vision → trả về placeholder để không crash
  console.warn("[AI] Không có vision provider → bỏ qua phân tích ảnh");
  return {
    character: "Nhân vật trong ảnh tham chiếu",
    outfit: "Trang phục như trong ảnh tham chiếu",
    background: "Bối cảnh như trong ảnh tham chiếu",
    lighting: "Ánh sáng tự nhiên",
    colorPalette: "Màu sắc tự nhiên",
    cameraAngle: "Medium shot",
    style: "Professional",
    emotion: "Tự tin, năng động",
    props: "",
    brand: "",
    videoDirections: "Giữ nguyên style như ảnh tham chiếu",
  };
}

interface ImageAnalysis {
  character: string;
  outfit: string;
  background: string;
  lighting: string;
  colorPalette: string;
  cameraAngle: string;
  style: string;
  emotion: string;
  props: string;
  brand: string;
  videoDirections: string;
}

// ─── BƯỚC 2: SINH KỊCH BẢN (có đầy đủ context) ───────────────────────────────
async function callAIText(model: string, prompt: string): Promise<string> {
  // 1. Gemini
  if (GEMINI_KEYS.length > 0) {
    try { return await callGeminiText(model, prompt); }
    catch (err) {
      if (isQuotaError(err)) { console.warn("[AI] Gemini hết quota → DeepSeek"); }
      else throw err;
    }
  }
  // 2. DeepSeek
  if (DEEPSEEK_KEY) {
    try {
      return await callOpenAICompat(
        "https://api.deepseek.com/chat/completions",
        DEEPSEEK_KEY,
        "deepseek-v4-flash",
        [{ role: "user", content: prompt }]
      );
    } catch (err) {
      if (isQuotaError(err)) { console.warn("[AI] DeepSeek hết quota → OpenAI"); }
      else throw err;
    }
  }
  // 3. OpenAI
  if (OPENAI_KEY) {
    return await callOpenAICompat(
      "https://api.openai.com/v1/chat/completions",
      OPENAI_KEY,
      "gpt-4o-mini",
      [{ role: "user", content: prompt }]
    );
  }
  throw new Error("Tất cả API đều hết quota hoặc chưa cấu hình trên Vercel.");
}

// ─── GỢI Ý TIÊU ĐỀ NHANH ─────────────────────────────────────────────────────
export async function suggestScripts(contentSnippet: string): Promise<string[]> {
  if (!contentSnippet || contentSnippet.trim().split(/\s+/).length < 4) return [];

  const prompt = `Dựa trên nội dung sau, đề xuất 3 tiêu đề viral ngắn gọn cho video TikTok/Reels xây dựng thương hiệu cá nhân.
Yêu cầu: Mỗi tiêu đề tối đa 20 từ, tiếng Việt, kích thích tò mò.
Nội dung: "${contentSnippet}"
Trả về JSON: {"suggestions": ["tiêu đề 1", "tiêu đề 2", "tiêu đề 3"]}`;

  try {
    const text = await callAIText("gemini-2.5-flash", prompt);
    const data = JSON.parse(text);
    const arr = data.suggestions ?? data;
    if (Array.isArray(arr)) return arr.slice(0, 3);
  } catch (e) {
    console.error("[suggestScripts]", e);
  }
  return [];
}

// ─── SINH KỊCH BẢN CHÍNH ─────────────────────────────────────────────────────
export async function generateContent(state: AppState): Promise<GeneratedResult> {
  const modelTimeLimit = state.videoModel === "Veo 3" ? 8 : 10;

  // ── Lấy ảnh tham chiếu đã chọn ──
  const refImageDataUrl =
    state.selectedImageIndex !== null && state.images[state.selectedImageIndex]
      ? state.images[state.selectedImageIndex]
      : null;

  // ── Bước 1: Phân tích ảnh ──
  let imgCtx: ImageAnalysis | null = null;
  if (refImageDataUrl) {
    console.log("[AI] Bắt đầu phân tích ảnh tham chiếu...");
    imgCtx = await analyzeReferenceImage(refImageDataUrl);
    console.log("[AI] Phân tích ảnh hoàn tất:", imgCtx);
  } else {
    console.warn("[AI] Không có ảnh tham chiếu → tạo kịch bản không có ảnh");
  }

  // ── Bước 2: Xây dựng prompt đầy đủ ──
  const imageContext = imgCtx
    ? `
=== PHÂN TÍCH ẢNH THAM CHIẾU ===
Nhân vật: ${imgCtx.character}
Trang phục: ${imgCtx.outfit}
Bối cảnh: ${imgCtx.background}
Ánh sáng: ${imgCtx.lighting}
Bảng màu: ${imgCtx.colorPalette}
Góc quay gốc: ${imgCtx.cameraAngle}
Phong cách: ${imgCtx.style}
Cảm xúc nhân vật: ${imgCtx.emotion}
Đạo cụ: ${imgCtx.props || "Không có"}
Thương hiệu/Logo: ${imgCtx.brand || "Không nhận diện được"}
Gợi ý video từ ảnh: ${imgCtx.videoDirections}
=================================`
    : `=== KHÔNG CÓ ẢNH THAM CHIẾU ===
Tạo video prompt phù hợp với nội dung, không mô tả nhân vật cụ thể.
================================`;

  const voiceGuidance =
    state.voice === "Bắc"
      ? "Giọng Bắc: rõ ràng, chuẩn mực, năng động"
      : state.voice === "Nam"
      ? "Giọng Nam: ấm áp, gần gũi, nhẹ nhàng"
      : "Giọng Trung: truyền cảm, đặc sắc";

  const prompt = `Bạn là chuyên gia viết kịch bản video ngắn viral cho TikTok/Reels/Shorts, chuyên về xây dựng thương hiệu cá nhân.

${imageContext}

=== DỮ LIỆU ĐẦU VÀO CỦA NGƯỜI DÙNG ===
Tiêu đề / Nội dung chính: "${state.content}"
Điều khiển AI (style, cảm xúc, hành động...): "${state.notes || "Không có yêu cầu đặc biệt"}"
Số cảnh quay: ${state.sceneCount}
Giọng đọc: ${state.voice} (${voiceGuidance})
Model video / Thời lượng: ${state.videoModel} — ${modelTimeLimit} giây mỗi cảnh
======================================

=== QUY TẮC TẠO VIDEO PROMPT (bắt buộc tuân thủ) ===
${imgCtx ? `
1. NHÂN VẬT: Luôn mô tả nhân vật ĐÚNG với ảnh tham chiếu:
   - Ngoại hình: ${imgCtx.character}
   - Trang phục: ${imgCtx.outfit}
   - Cảm xúc: phù hợp với nội dung từng cảnh, giữ nét ${imgCtx.emotion}
2. BỐI CẢNH: Ưu tiên giữ bối cảnh gốc (${imgCtx.background}) hoặc mở rộng phù hợp nội dung
3. MÀU SẮC & ÁNH SÁNG: Duy trì tông màu ${imgCtx.colorPalette}, ánh sáng ${imgCtx.lighting}
4. GÓC QUAY: Biến tấu hợp lý từ góc gốc (${imgCtx.cameraAngle}): close-up cảm xúc, medium shot hành động
5. PHONG CÁCH: Nhất quán ${imgCtx.style} xuyên suốt tất cả cảnh` : `
1. Không mô tả nhân vật cụ thể (không có ảnh tham chiếu)
2. Tập trung vào hành động, bối cảnh, ánh sáng chung chung`}
6. TUYỆT ĐỐI KHÔNG: chữ/text trên video, chuyển cảnh trong 1 prompt, thay đổi nhân vật giữa các cảnh
7. Hành động phải thực tế, tự nhiên như người thật
8. Video prompt viết bằng TIẾNG ANH, chi tiết và cụ thể
=====================================================

=== QUY TẮC LỜI THOẠI (voiceScript) ===
1. Viết bằng TIẾNG VIỆT, ${voiceGuidance}
2. Tự nhiên như người thật đang nói chuyện với camera
3. ${modelTimeLimit === 8
  ? `Giới hạn ${modelTimeLimit}s: PHẢI từ 20-24 từ mỗi cảnh. Đếm từ nội tâm trước khi viết.`
  : `Giới hạn ${modelTimeLimit}s: PHẢI từ 24-28 từ mỗi cảnh. Đếm từ nội tâm trước khi viết.`}
4. Không vượt giới hạn từ. Câu ngắn, dễ đọc, cảm xúc thật
5. Phù hợp với style và điều khiển AI: "${state.notes || "tự nhiên, chân thực"}"
========================================

=== QUY TẮC HOOK & HASHTAG ===
1. Hook: 1 câu viral tiếng Việt, giữ người xem ngay 3 giây đầu
2. Hashtag: 5 hashtag liên quan (bắt đầu bằng #)
===============================

=== QUY TẮC THUMBNAIL ===
1. 3 biến thể tiêu đề thumbnail tiếng Việt
2. Tối đa 80 ký tự mỗi tiêu đề
3. Ngắn gọn, viral, gây tò mò, phù hợp mobile
==========================

OUTPUT FORMAT — CHỈ TRẢ VỀ JSON HỢP LỆ:
{
  "hook": "câu hook tiếng Việt",
  "hashtags": ["#tag1", "#tag2", "#tag3", "#tag4", "#tag5"],
  "scenes": [
    {
      "videoPrompt": "English: detailed visual description consistent with reference image...",
      "voiceScript": "Tiếng Việt: lời thoại tự nhiên..."
    }
  ],
  "thumbnailTexts": ["Tiêu đề 1", "Tiêu đề 2", "Tiêu đề 3"]
}

QUAN TRỌNG: Phải có đúng ${state.sceneCount} phần tử trong mảng "scenes". Chỉ trả JSON, không thêm bất kỳ text nào khác.`;

  // ── Gọi AI sinh kịch bản ──
  const text = await callAIText("gemini-2.5-flash", prompt);
  if (!text) throw new Error("AI không trả về kết quả. Vui lòng thử lại.");

  const data = JSON.parse(text);

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
    thumbnailVariations: data.thumbnailTexts.map((t: string, i: number) => ({
      text: t,
      styleClass: shuffledStyles[i % shuffledStyles.length],
    })),
    inputs: state,
  };
}
