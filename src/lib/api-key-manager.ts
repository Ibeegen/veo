export type ProviderType = 'google' | 'openai' | 'deepseek';
export type KeyTier = 'free' | 'paid';

export interface ApiKey {
  key: string;
  tier: KeyTier;
  label: string;
  active: boolean;
  failReason?: string;
  failTime?: number;
}

export interface ProviderConfig {
  keys: ApiKey[];
  currentIndex: number;
  model: string;
  endpoint: string;
}

export interface ApiConfig {
  google: ProviderConfig;
  openai: ProviderConfig;
  deepseek: ProviderConfig;
}

const STORAGE_KEY = "api_key_manager_v1";

/**
 * ApiKeyManager: Hệ thống quản lý API key thông minh
 * Hỗ trợ nhiều key, tự động xoay vòng free -> paid, và backup/restore.
 * Chạy được trên cả Frontend (LocalStorage) và Backend Nodejs/Vercel (Env Vars).
 */
export class ApiKeyManager {
  private config: ApiConfig;

  constructor() {
    this.config = this.getDefaultConfig();
    this.loadConfig();
    this.loadEnvKeys(); // Fallback load từ Environment varibles nếu có
  }

  /**
   * Cấu hình mặc định hệ thống
   */
  private getDefaultConfig(): ApiConfig {
    return {
      google: {
        keys: [],
        currentIndex: 0,
        model: "gemini-1.5-flash",
        endpoint: "https://generativelanguage.googleapis.com/v1beta/models"
      },
      openai: {
        keys: [],
        currentIndex: 0,
        model: "gpt-4o-mini",
        endpoint: "https://api.openai.com/v1/chat/completions"
      },
      deepseek: {
        keys: [],
        currentIndex: 0,
        model: "deepseek-chat",
        endpoint: "https://api.deepseek.com/chat/completions"
      }
    };
  }

  /**
   * Load key từ Environment Variables (Hỗ trợ Vercel Serverless và Vite local)
   */
  private loadEnvKeys() {
    // Tương thích cả Node.js process.env và Vite import.meta.env
    const pEnv = typeof process !== 'undefined' ? process.env : {};
    // @ts-ignore
    const mEnv = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : {};

    const getVar = (name: string, viteName: string) => pEnv[name] || mEnv[viteName];

    const googleKey = getVar('GOOGLE_API_KEY', 'VITE_GOOGLE_API_KEY') || getVar('GEMINI_API_KEY', 'VITE_GEMINI_API_KEY');
    if (googleKey && !this.config.google.keys.find(k => k.key === googleKey)) {
       this.config.google.keys.push({ key: googleKey, tier: 'free', label: 'ENV Google Key', active: true });
    }

    const openaiKey = getVar('OPENAI_API_KEY', 'VITE_OPENAI_API_KEY');
    if (openaiKey && !this.config.openai.keys.find(k => k.key === openaiKey)) {
       this.config.openai.keys.push({ key: openaiKey, tier: 'free', label: 'ENV OpenAI Key', active: true });
    }

    const deepseekKey = getVar('DEEPSEEK_API_KEY', 'VITE_DEEPSEEK_API_KEY');
    if (deepseekKey && !this.config.deepseek.keys.find(k => k.key === deepseekKey)) {
       this.config.deepseek.keys.push({ key: deepseekKey, tier: 'free', label: 'ENV Deepseek Key', active: true });
    }
  }

  /**
   * Mã hoá base64 hỗ trợ unicode an toàn
   */
  private encodeBase64(str: string): string {
    if (typeof window !== 'undefined' && window.btoa) {
      return window.btoa(unescape(encodeURIComponent(str)));
    }
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(str, 'utf8').toString('base64');
    }
    return str;
  }

  /**
   * Giải mã base64 hỗ trợ unicode
   */
  private decodeBase64(str: string): string {
    if (typeof window !== 'undefined' && window.atob) {
      return decodeURIComponent(escape(window.atob(str)));
    }
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(str, 'base64').toString('utf8');
    }
    return str;
  }

  /**
   * Đọc cấu hình từ LocalStorage
   */
  private loadConfig() {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const decoded = this.decodeBase64(stored);
        const parsed = JSON.parse(decoded);
        this.config = { ...this.getDefaultConfig(), ...parsed };
      }
    } catch (e) {
      console.warn('[ApiKeyManager] Lỗi đọc config từ localStorage', e);
    }
  }

  /**
   * Lưu cấu hình xuống LocalStorage
   */
  private saveConfig() {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      const encoded = this.encodeBase64(JSON.stringify(this.config));
      localStorage.setItem(STORAGE_KEY, encoded);
    } catch (e) {
      console.warn('[ApiKeyManager] Lỗi lưu config xuống localStorage', e);
    }
  }

  /**
   * 1. Thêm key mới
   */
  public addKey(provider: ProviderType, keyConfig: Omit<ApiKey, 'active'>) {
    if (!this.config[provider]) return;
    
    // Tránh trùng lặp key
    if (this.config[provider].keys.some(k => k.key === keyConfig.key)) return;

    this.config[provider].keys.push({
      ...keyConfig,
      active: true
    });
    this.saveConfig();
  }

  /**
   * 2. Xóa key theo tên label
   */
  public removeKey(provider: ProviderType, keyLabel: string) {
    if (!this.config[provider]) return;
    this.config[provider].keys = this.config[provider].keys.filter(k => k.label !== keyLabel);
    
    // Nếu list rỗng thì reset index
    if (this.config[provider].keys.length === 0) {
      this.config[provider].currentIndex = 0;
    }
    this.saveConfig();
  }

  /**
   * 3. Lấy key tiếp theo: ưu tiên free trước, paid sau
   */
  public getNextKey(provider: ProviderType): ApiKey {
    const config = this.config[provider];
    if (!config || !config.keys.length) {
      throw new Error(`Chưa có cấu hình key cho provider: ${provider}`);
    }

    // Lọc lấy các keys đang active
    const freeKeys = config.keys.filter(k => k.tier === 'free' && k.active);
    const paidKeys = config.keys.filter(k => k.tier === 'paid' && k.active);

    const availableKeys = [...freeKeys, ...paidKeys];

    if (availableKeys.length === 0) {
      throw new Error(`Hết quota tất cả key của [${provider}]`);
    }

    // Lấy key hiện tại theo thuật toán vòng lặp module
    const currentKey = availableKeys[config.currentIndex % availableKeys.length];
    
    // Tịnh tiến index cho lần tiếp theo
    config.currentIndex = (config.currentIndex + 1) % availableKeys.length;
    this.saveConfig();

    return currentKey;
  }

  /**
   * 4. Ghi nhận lỗi key (429 Quota hoặc 401 Invalid)
   */
  public markKeyFailed(provider: ProviderType, key: string, reason: string) {
    const config = this.config[provider];
    if (!config) return;

    const failedKeyIdx = config.keys.findIndex(k => k.key === key);
    if (failedKeyIdx !== -1) {
      config.keys[failedKeyIdx].active = false;
      config.keys[failedKeyIdx].failReason = reason;
      config.keys[failedKeyIdx].failTime = Date.now();
      
      console.warn(`[ApiKeyManager] Rotate key: [${config.keys[failedKeyIdx].label}] của ${provider} failed. Reason: ${reason}. Trạng thái active -> false.`);
      this.saveConfig();
    }
  }

  /**
   * 5. Lấy trạng thái hệ thống
   */
  public getStatus() {
    const status: Record<string, any> = {};
    for (const [provider, config] of Object.entries(this.config)) {
      status[provider] = {
        model: config.model,
        totalKeys: config.keys.length,
        activeKeys: config.keys.filter(k => k.active).length,
        freeActive: config.keys.filter(k => k.tier === 'free' && k.active).length,
        paidActive: config.keys.filter(k => k.tier === 'paid' && k.active).length,
      };
    }
    return status;
  }

  /**
   * Lấy cấu hình toàn bộ (dùng cho export)
   */
  public exportConfig(): string {
    return JSON.stringify(this.config, null, 2);
  }

  /**
   * Import cấu hình từ file
   */
  public importConfig(jsonString: string) {
    try {
      const parsed = JSON.parse(jsonString);
      // Có thể chạy qua một hàm validate trước khi gán
      this.config = { ...this.getDefaultConfig(), ...parsed };
      this.saveConfig();
      return true;
    } catch (e) {
      console.error("[ApiKeyManager] Lỗi import config", e);
      return false;
    }
  }
}

// Khởi tạo global instance có thể sử dụng dùng chung
export const apiKeyManager = new ApiKeyManager();
