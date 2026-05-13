import { ProviderType } from './api-key-manager';
import { aiAdapter, ChatMessage, ChatOptions } from './ai-adapter';

/**
 * ApiClient gọi API chat - tự động điều phối theo môi trường.
 */
export async function sendMessage(provider: ProviderType, messages: ChatMessage[], options: ChatOptions = {}) {
  // Detect localhost an toàn mà không lỗi SSR trong Vercel
  const isLocal = typeof window !== 'undefined' && 
                 (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

  if (isLocal) {
    // Chế độ dev local -> Gọi thẳng (dùng key được khai báo local storage hoặc Vite VITE_)
    console.log('[ApiClient] Gọi API trực tiếp từ Client (Local Mode)');
    try {
      const response = await aiAdapter.chat(provider, messages, options);
      return { success: true, ...response };
    } catch (e: any) {
      return { success: false, error: e.message || String(e) };
    }
  } else {
    // Chế độ Server / Production -> Gọi qua Vercel serverless API để hide key
    console.log(`[ApiClient] Gọi API qua Vercel Function (/api/chat-${provider})`);
    try {
      const res = await fetch(`/api/chat-${provider}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json' 
        },
        body: JSON.stringify({ messages, options })
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Lỗi serverless function');
      }
      return data;
    } catch (e: any) {
      console.error('[ApiClient-Vercel]', e);
      return { success: false, error: e.message || String(e) };
    }
  }
}
