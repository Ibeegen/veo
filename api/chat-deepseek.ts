import { apiKeyManager } from '../src/lib/api-key-manager';
import { aiAdapter } from '../src/lib/ai-adapter';

// Đọc tự động các key từ Env vars
for (let i = 1; i <= 10; i++) {
    const key = process.env[`DEEPSEEK_API_KEY_${i}`];
    if (key) {
        apiKeyManager.addKey('deepseek', { key, tier: 'free', label: `ENV DeepSeek Key ${i}` });
    }
}
if (process.env.DEEPSEEK_API_KEY) {
    apiKeyManager.addKey('deepseek', { key: process.env.DEEPSEEK_API_KEY as string, tier: 'free', label: `ENV DeepSeek Base Key` });
}

const rateLimitMap = new Map<string, { count: number, resetAt: number }>();

export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '127.0.0.1';
  const now = Date.now();
  const limitInfo = rateLimitMap.get(ip);
  if (!limitInfo || now > limitInfo.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + 60000 });
  } else if (limitInfo.count >= 20) {
    return res.status(429).json({ success: false, error: 'Quá nhiều request API. Vui lòng thử lại sau.' });
  } else {
    limitInfo.count++;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const { messages, options } = req.body;
    const response = await aiAdapter.chat('deepseek', messages, options);
    return res.status(200).json({ success: true, ...response });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: error.message || String(error) });
  }
}
