import localforage from "localforage";
import { GeneratedResult, STORAGE_KEY } from "../types";

export async function saveResult(result: GeneratedResult): Promise<void> {
  const current = await getHistory();
  // Add to top, keep last 24h?
  // User asked for: "Lưu trong 24h, hiển thị 3 kết quả gần nhất."
  const now = Date.now();
  const ONE_DAY = 24 * 60 * 60 * 1000;
  
  let validHistory = current.filter(item => now - item.timestamp < ONE_DAY);
  validHistory.unshift(result);
  
  // Keep only the most recent to avoid localstorage bloat if necessary, but 24h is the rule.
  
  await localforage.setItem(STORAGE_KEY, validHistory);
}

export async function getHistory(): Promise<GeneratedResult[]> {
  const data = await localforage.getItem<GeneratedResult[]>(STORAGE_KEY);
  if (!data) return [];
  
  const now = Date.now();
  const ONE_DAY = 24 * 60 * 60 * 1000;
  // Clean up old ones when fetching
  const validHistory = data.filter(item => now - item.timestamp < ONE_DAY);
  
  if (validHistory.length !== data.length) {
    await localforage.setItem(STORAGE_KEY, validHistory);
  }
  
  return validHistory;
}
