import { GoogleGenAI } from "@google/genai";

// ─── LOAD SERVER-SIDE KEYS (giống chat-google.ts) ────────────────────────────
const GOOGLE_KEYS: string[] = [];
for (let i = 1; i <= 10; i++) {
  const k = process.env[`GOOGLE_API_KEY_${i}`];
  if (k) GOOGLE_KEYS.push(k);
}
if (process.env.GOOGLE_API_KEY) GOOGLE_KEYS.push(process.env.GOOGLE_API_KEY);

// OpenAI fallback (nếu có)
const OPENAI_KEY = process.env.OPENAI_API_KEY_1 || process.env.OPENAI_API_KEY;

export const maxDuration = 30;

const ANALYSIS_PROMPT = `Phân tích chi tiết hình ảnh này để dùng làm ảnh tham chiếu cho video ngắn TikTok/Reels.
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

async function analyzeWithGemini(mimeType: string, base64: string): Promise<any> {
  let lastErr: any;
  for (const key of GOOGLE_KEYS) {
    try {
      const ai = new GoogleGenAI({ apiKey: key });
      const res = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
          {
            role: "user",
            parts: [
              { inlineData: { mimeType: mimeType as any, data: base64 } },
              { text: ANALYSIS_PROMPT },
            ],
          },
        ],
        config: { responseMimeType: "application/json" },
      });
      if (res.text) return JSON.parse(res.text);
      throw new Error("Empty response");
    } catch (err: any) {
      lastErr = err;
      const isQuota =
        err?.status === 429 ||
        String(err?.message).includes("429") ||
        String(err?.message).includes("quota");
      if (isQuota) {
        console.warn("[analyze-image] Gemini key hết quota → thử key tiếp");
        continue;
      }
      throw err;
    }
  }
  throw lastErr || new Error("Không có Gemini key hợp lệ");
}

async function analyzeWithOpenAI(imageDataUrl: string): Promise<any> {
  if (!OPENAI_KEY) throw new Error("Không có OpenAI key");
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: imageDataUrl, detail: "high" } },
            { type: "text", text: ANALYSIS_PROMPT },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error?.message || `HTTP ${res.status}`);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content ?? "";
  return JSON.parse(text);
}

export default async function handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,POST");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "X-CSRF-Token, X-Requested-With, Accept, Content-Type"
  );

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ success: false, error: "Method not allowed" });

  try {
    const { imageDataUrl } = req.body as { imageDataUrl?: string };
    if (!imageDataUrl || !imageDataUrl.startsWith("data:")) {
      return res
        .status(400)
        .json({ success: false, error: "imageDataUrl không hợp lệ" });
    }

    // Parse data URL: data:<mimeType>;base64,<data>
    const match = imageDataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      return res
        .status(400)
        .json({ success: false, error: "Không parse được data URL" });
    }
    const [, mimeType, base64] = match;

    // Thử Gemini trước, fallback OpenAI
    let analysis: any;
    if (GOOGLE_KEYS.length > 0) {
      try {
        analysis = await analyzeWithGemini(mimeType, base64);
      } catch (err) {
        console.warn("[analyze-image] Gemini vision lỗi, thử OpenAI:", err);
        if (OPENAI_KEY) {
          analysis = await analyzeWithOpenAI(imageDataUrl);
        } else {
          throw err;
        }
      }
    } else if (OPENAI_KEY) {
      analysis = await analyzeWithOpenAI(imageDataUrl);
    } else {
      return res.status(500).json({
        success: false,
        error: "Chưa cấu hình GOOGLE_API_KEY hoặc OPENAI_API_KEY trên Vercel",
      });
    }

    return res.status(200).json({ success: true, analysis });
  } catch (error: any) {
    console.error("[analyze-image] Error:", error);
    return res
      .status(500)
      .json({ success: false, error: error.message || String(error) });
  }
}
