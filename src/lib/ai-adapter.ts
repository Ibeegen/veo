import { apiKeyManager, ProviderType } from './api-key-manager';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
}

export interface ChatResponse {
  text: string;
  provider: ProviderType;
  model: string;
  keyUsed?: string;
  tokensUsed?: number;
}

/**
 * AiAdapter - Hỗ trợ gọi 3 API khác nhau (Google, OpenAI, DeepSeek) với cùng 1 interface
 * Tính hợp tự động xoay key, retry nhiều lần khi lỗi (429, 401, 403)
 */
export class AiAdapter {
  /**
   * Phương thức duy nhất để chat
   */
  async chat(provider: ProviderType, messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResponse> {
    const maxRetries = 3;
    let attempt = 0;
    
    while (attempt < maxRetries) {
      attempt++;
      let keyData: any;
      try {
        keyData = apiKeyManager.getNextKey(provider);
      } catch (e: any) {
        // Hết tất cả key
        throw new Error(e.message);
      }

      try {
        if (provider === 'google') {
           return await this.chatGoogle(keyData.key, messages, options, keyData.label);
        } else if (provider === 'openai') {
           return await this.chatOpenAI(keyData.key, messages, options, keyData.label);
        } else if (provider === 'deepseek') {
           return await this.chatDeepseek(keyData.key, messages, options, keyData.label);
        }
        throw new Error('Unsupported provider');
      } catch (error: any) {
        const status = error.status || 500;
        const isRateLimit = status === 429 || status === 401 || status === 403;
        
        if (isRateLimit) {
           apiKeyManager.markKeyFailed(provider, keyData.key, `HTTP ${status}: ${error.message}`);
           if (attempt >= maxRetries) {
             throw new Error(`Hết quota tất cả key hoặc quá số lần thử lại cho [${provider}]`);
           }
           // Sẽ retry vòng lặp while với key tiếp theo
        } else {
           // Gặp lỗi khác ngoài quota/auth -> throw ngay lập tức
           throw error; 
        }
      }
    }
    throw new Error('Lỗi adapter ngoài dự kiến');
  }

  private async chatGoogle(key: string, messages: ChatMessage[], options: ChatOptions, keyLabel: string): Promise<ChatResponse> {
    const model = 'gemini-1.5-flash';
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
    
    const mappedMessages = messages.filter(m => m.role !== 'system').map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));
    
    const sysMsg = messages.find(m => m.role === 'system');

    const payload: any = {
      contents: mappedMessages,
      generationConfig: {
        temperature: options.temperature,
        maxOutputTokens: options.maxTokens,
      }
    };
    if (sysMsg) {
        payload.systemInstruction = { parts: [{ text: sysMsg.content }] };
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
        throw { status: response.status, message: await response.text() };
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return { text, provider: 'google', model, keyUsed: keyLabel };
  }

  private async chatOpenAI(key: string, messages: ChatMessage[], options: ChatOptions, keyLabel: string): Promise<ChatResponse> {
    const model = 'gpt-4o-mini';
    const endpoint = 'https://api.openai.com/v1/chat/completions';
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: options.temperature,
        max_tokens: options.maxTokens,
      })
    });

    if (!response.ok) {
        throw { status: response.status, message: await response.text() };
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';
    return { text, provider: 'openai', model, keyUsed: keyLabel, tokensUsed: data.usage?.total_tokens };
  }

  private async chatDeepseek(key: string, messages: ChatMessage[], options: ChatOptions, keyLabel: string): Promise<ChatResponse> {
    const model = 'deepseek-chat';
    const endpoint = 'https://api.deepseek.com/chat/completions';
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: options.temperature,
        max_tokens: options.maxTokens,
      })
    });

    if (!response.ok) {
        throw { status: response.status, message: await response.text() };
    }

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || '';
    return { text, provider: 'deepseek', model, keyUsed: keyLabel, tokensUsed: data.usage?.total_tokens };
  }
}

export const aiAdapter = new AiAdapter();
