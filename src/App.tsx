import React, { useState, useEffect, useRef } from "react";
import { Plus, Minus, ImagePlus, Check, Copy, Wand2, History, Trash2, Edit2, Play, Sparkles, Download, Loader2, RefreshCw, X } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { toast } from "sonner";
import { toCanvas } from "html-to-image";
import { Toaster } from "./components/ui/sonner";
import { compressImage } from "./lib/image";
import { suggestScripts, generateContent } from "./services/ai";
import { getHistory, saveResult } from "./services/storage";
import { AppState, GeneratedResult, VoiceType, VideoModelType } from "./types";
import localforage from "localforage";

import { Button } from "./components/ui/button";
import { Textarea } from "./components/ui/textarea";
import { Label } from "./components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./components/ui/card";
import { Badge } from "./components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./components/ui/tabs";
import { ScrollArea, ScrollBar } from "./components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";
import { Separator } from "./components/ui/separator";

const INITIAL_STATE: AppState = {
  images: [],
  selectedImageIndex: null,
  content: "",
  notes: "",
  sceneCount: 3,
  voice: "Bắc",
  videoModel: "Veo 3",
};

const IMAGE_LIBRARY_KEY = "clipbrand_image_library";

function ThumbnailItem({ thumb, refImage, idx }: { key?: React.Key, thumb: any, refImage: string | undefined, idx: number }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    if (!cardRef.current) return;
    setDownloading(true);
    try {
      const node = cardRef.current;
      const { clientWidth, clientHeight } = node;
      
      // Target resolution
      const targetWidth = 1080;
      const targetHeight = 1920;
      
      // Calculate ratio based on actual DOM size vs target size
      const ratio = targetWidth / clientWidth;

      const canvas = await toCanvas(node, {
         pixelRatio: ratio,
         style: {
           borderRadius: '0', 
           transform: 'none',
         }
      });
      const dataUrl = canvas.toDataURL('image/webp', 0.95);
      const link = document.createElement('a');
      link.download = `clipbrand-thumb-${idx + 1}.webp`;
      link.href = dataUrl;
      link.click();
      toast.success("Đã tải ảnh");
    } catch (e) {
      console.error("Export error:", e);
      toast.error("Lỗi khi tải ảnh");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div 
        ref={cardRef} 
        className="relative aspect-[9/16] rounded-xl overflow-hidden bg-zinc-200 dark:bg-zinc-800 shadow-md group @container"
      >
        {refImage ? (
          <img src={refImage} className="absolute inset-0 w-full h-full object-cover filter brightness-[0.85] contrast-110 saturate-110 group-hover:scale-105 transition-transform duration-500" alt="Thumbnail base" />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-zinc-300 to-zinc-400 dark:from-zinc-800 dark:to-zinc-900" />
        )}
        {/* Gradient Overlay for better contrast */}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-black/10 to-black/70 pointer-events-none" />
        
        {/* Overlay Title */}
        <div className="absolute bottom-[15%] left-0 right-0 flex items-center justify-center px-4 w-full z-10 pointer-events-none">
           <div 
              className={`max-w-[95%] text-center text-balance transition-all duration-300 group-hover:scale-[1.02] leading-[1.3] ${thumb.styleClass || thumb.gradient || "bg-gradient-to-r from-[#F5A623] to-[#EA580C] text-white rounded-xl p-3 font-title"}`}
              style={{ fontSize: "clamp(0.95rem, 5.5cqw, 1.3rem)" }}
            >
             {thumb.text}
           </div>
        </div>
      </div>
      <Button 
        onClick={handleDownload} 
        disabled={downloading}
        variant="outline"
        className="w-full flex items-center justify-center gap-2 border-brand-blue text-brand-blue hover:bg-brand-blue hover:text-white rounded-[10px] min-h-[44px] transition-colors font-semibold"
      >
        {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
        {downloading ? "Đang xử lý..." : "Tải ảnh"}
      </Button>
    </div>
  );
}

export default function App() {
  const [state, setState] = useState<AppState>(INITIAL_STATE);
  const [history, setHistory] = useState<GeneratedResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [currentResult, setCurrentResult] = useState<GeneratedResult | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const suggestionTimeout = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    loadHistory();
    loadImageLibrary();
  }, []);

  // Fix 2: Load & Save ảnh thư viện
  const loadImageLibrary = async () => {
    try {
      const saved = await localforage.getItem<string[]>(IMAGE_LIBRARY_KEY);
      if (saved && saved.length > 0) {
        setState(s => ({ ...s, images: saved, selectedImageIndex: 0 }));
      }
    } catch (e) {
      console.warn("Không load được thư viện ảnh", e);
    }
  };

  const saveImageLibrary = async (images: string[]) => {
    try {
      // Giữ tối đa 6 ảnh gần nhất để tránh tràn bộ nhớ
      await localforage.setItem(IMAGE_LIBRARY_KEY, images.slice(0, 6));
    } catch (e) {
      console.warn("Không lưu được thư viện ảnh", e);
    }
  };

  // Fix 3: Tạo mới kịch bản
  const handleNewScript = () => {
    setState({ ...INITIAL_STATE, images: state.images, selectedImageIndex: state.selectedImageIndex });
    setCurrentResult(null);
    setSuggestions([]);
    toast.info("Đã tạo kịch bản mới. Giữ lại ảnh tham chiếu cũ.");
  };

  const loadHistory = async () => {
    const hist = await getHistory();
    setHistory(hist);
    if (!currentResult && hist.length > 0) {
      setCurrentResult(hist[0]);
    }
  };

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    if (val.trim().split(/\s+/).length > 2000) return;
    setState((s) => ({ ...s, content: val }));

    if (suggestionTimeout.current) clearTimeout(suggestionTimeout.current);

    if (val.trim().split(/\s+/).length >= 4) {
      // Fix 1: Giảm debounce xuống 500ms để gợi ý nhanh hơn
      suggestionTimeout.current = setTimeout(async () => {
        setSuggestLoading(true);
        try {
          const sugs = await suggestScripts(val);
          setSuggestions(sugs);
        } catch (err: any) {
          // Lỗi key thì không show gợi ý, không hiện toast để không làm phiền
          setSuggestions([]);
        } finally {
          setSuggestLoading(false);
        }
      }, 500);
    } else {
      setSuggestions([]);
    }
  };

  const handleNotesChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    if (val.trim().split(/\s+/).length > 100) return;
    setState((s) => ({ ...s, notes: val }));
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      try {
        const compressed = await compressImage(file);
        setState((s) => {
          const newImages = [compressed, ...s.images].slice(0, 6);
          // Fix 2: Lưu vào thư viện
          saveImageLibrary(newImages);
          return { ...s, images: newImages, selectedImageIndex: 0 };
        });
        toast.success("Đã thêm ảnh vào thư viện!");
      } catch (err) {
        toast.error("Lỗi khi tải ảnh lên.");
      }
    }
  };

  const handleGenerate = async () => {
    if (!state.content.trim()) {
      toast.error("Vui lòng nhập nội dung kịch bản.");
      return;
    }
    if (state.selectedImageIndex === null || !state.images[state.selectedImageIndex]) {
      toast.warning("Chưa chọn ảnh tham chiếu. Đang sử dụng ảnh mặc định (nếu có).");
    }

    setLoading(true);
    try {
      const result = await generateContent(state);
      await saveResult(result);
      setCurrentResult(result);
      toast.success("Tạo kịch bản thành công!");
      await loadHistory();
    } catch (error: any) {
      console.error(error);
      const msg = error?.message || "";
      if (msg.includes("API Key") || msg.includes("api_key") || msg.includes("API key") || msg.includes("GEMINI") || msg.includes("Chưa có")) {
        toast.error("⚠️ Chưa có API Key! Vào trang 'Quản lý API Keys' để nhập Gemini key của bạn.", { duration: 6000 });
      } else if (msg.includes("quota") || msg.includes("429")) {
        toast.error("🔴 Hết quota API Key. Hãy đổi key khác hoặc chờ reset.", { duration: 5000 });
      } else if (msg.includes("401") || msg.includes("invalid")) {
        toast.error("🔑 API Key không hợp lệ. Kiểm tra lại key trong trang Quản lý API Keys.", { duration: 5000 });
      } else {
        toast.error("Có lỗi xảy ra khi tạo kịch bản. Vui lòng thử lại.");
      }
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text: string, title: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`Đã copy ${title}!`);
  };

  const applyHistory = (hist: GeneratedResult) => {
    setState(hist.inputs);
    setCurrentResult(hist);
    toast.info("Đã khôi phục cài đặt từ lịch sử.");
  };

  return (
    <div className="min-h-screen bg-brand-bg-sub text-brand-text-body font-sans selection:bg-brand-yellow/30 pb-safe">
      <Toaster position="top-center" theme="light" toastOptions={{
        classNames: {
          success: 'bg-[#DCFCE7] border-l-4 border-l-[#22C55E] text-[#166534]',
          error: 'bg-[#FEE2E2] border-l-4 border-l-[#EF4444] text-[#991B1B]',
          info: 'bg-[#E0F2FE] border-l-4 border-l-[#0EA5E9] text-[#0C4A6E]',
        }
      }} />
      
      {/* Header */}
      <header className="sticky top-0 z-50 bg-gradient-to-br from-brand-blue to-brand-blue-dark shadow-md">
        <div className="max-w-[430px] md:max-w-7xl mx-auto px-4 h-16 flex items-center justify-between min-h-[44px]">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-brand-yellow-light flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-brand-text-title" />
            </div>
            <h1 className="font-bold text-lg tracking-tight text-white">ClipBrand AI</h1>
          </div>
          <div className="flex items-center gap-2">
            <p className="text-sm text-brand-bg-sub hidden sm:block font-medium">Chuyên gia video ngắn tự động</p>
            <button
              onClick={handleNewScript}
              title="Tạo kịch bản mới"
              className="flex items-center gap-1.5 bg-white/15 hover:bg-white/30 text-white text-xs font-semibold px-3 py-1.5 rounded-lg border border-white/30 transition-all"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Tạo mới
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-[430px] md:max-w-7xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-12 gap-8 mb-20 md:mb-0">
        
        {/* ⚠️ Banner cảnh báo khi chưa có API key */}
        {/* Left Column: Inputs */}
        <div className="lg:col-span-5 space-y-8">
          
          {/* Section 1: Image Upload */}
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <Label className="text-base font-semibold leading-none text-brand-text-title">1. Ảnh tham chiếu</Label>
              <span className="text-xs text-brand-text-muted">Thư viện: {state.images.length}/6 ảnh</span>
            </div>
            <Card className="border-brand-border border shadow-sm rounded-[16px] overflow-hidden bg-brand-bg-main shadow-[0_2px_12px_rgba(14,165,233,0.1)]">
              <div className="p-4">
                <ScrollArea className="w-full whitespace-nowrap">
                  <div className="flex w-max space-x-3 p-1">
                    <label className="flex flex-col items-center justify-center w-24 h-32 rounded-[12px] border-2 border-dashed border-brand-border hover:border-brand-blue hover:bg-brand-bg-sub cursor-pointer transition-colors snap-start min-w-[44px] min-h-[44px]">
                      <ImagePlus className="w-6 h-6 text-brand-blue mb-2" />
                      <span className="text-xs font-medium text-brand-text-muted">Thêm ảnh</span>
                      <input type="file" accept="image/*" className="hidden" ref={fileInputRef} onChange={handleFileUpload} />
                    </label>
                    {state.images.map((img, idx) => (
                      <div 
                        key={idx} 
                        onClick={() => setState(s => ({ ...s, selectedImageIndex: idx }))}
                        className={`relative w-24 h-32 rounded-[12px] overflow-hidden snap-start cursor-pointer transition-all ${state.selectedImageIndex === idx ? 'ring-2 ring-brand-blue ring-offset-2 scale-[0.98]' : 'opacity-70 hover:opacity-100'}`}
                      >
                        <img src={img} alt="Reference" className="w-full h-full object-cover" />
                        {state.selectedImageIndex === idx && (
                          <div className="absolute inset-0 bg-brand-blue/20 flex items-center justify-center">
                            <div className="bg-brand-yellow rounded-full p-1 shadow-md">
                              <Check className="w-4 h-4 text-brand-text-title" />
                            </div>
                          </div>
                        )}
                        {/* Nút xóa ảnh khỏi thư viện */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setState(s => {
                              const newImgs = s.images.filter((_, i) => i !== idx);
                              const newIdx = newImgs.length > 0 ? 0 : null;
                              saveImageLibrary(newImgs);
                              return { ...s, images: newImgs, selectedImageIndex: newIdx };
                            });
                          }}
                          className="absolute top-1 right-1 bg-black/60 hover:bg-red-500 text-white rounded-full p-0.5 transition-colors z-10"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <ScrollBar orientation="horizontal" />
                </ScrollArea>
              </div>
            </Card>
          </section>

          {/* Section 2: Content */}
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <Label className="text-base font-semibold leading-none text-brand-text-title">2. Nội dung / Tiêu đề</Label>
              <span className="text-xs text-brand-text-muted">{state.content.trim().split(/\s+/).filter(Boolean).length}/2000 từ</span>
            </div>
            <div className="relative">
              <Textarea 
                placeholder="Nhập ý tưởng, tiêu đề hoặc nội dung dài mà bạn muốn truyền tải..."
                className="min-h-[160px] resize-none text-base rounded-[12px] shadow-sm bg-brand-bg-sub border-[1.5px] border-brand-border focus-visible:border-[2px] focus-visible:border-brand-blue focus-visible:ring-0 placeholder:text-brand-placeholder text-brand-text-body"
                value={state.content}
                onChange={handleContentChange}
              />
              <AnimatePresence>
                {(suggestions.length > 0 || suggestLoading) && (
                  <motion.div 
                    initial={{ opacity: 0, y: -10 }} 
                    animate={{ opacity: 1, y: 0 }} 
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="absolute top-full left-0 right-0 mt-2 p-2 bg-brand-bg-main border border-brand-border rounded-xl shadow-xl z-10"
                  >
                    <p className="text-xs font-medium text-brand-text-muted px-2 pb-2 flex items-center gap-1">
                      <Sparkles className="w-3 h-3 text-brand-yellow" /> AI Gợi ý tiêu đề:
                      {suggestLoading && <Loader2 className="w-3 h-3 animate-spin ml-1 text-brand-blue" />}
                    </p>
                    <div className="space-y-2 max-h-[350px] overflow-y-auto px-1">
                      {suggestLoading && suggestions.length === 0 && (
                        <div className="px-3 py-3 text-sm text-brand-text-muted flex items-center gap-2">
                          <Loader2 className="w-4 h-4 animate-spin text-brand-blue" /> Đang tạo gợi ý...
                        </div>
                      )}
                      {suggestions.map((sug, i) => (
                        <button 
                          key={i} 
                          onClick={() => {
                            setState(s => ({ ...s, content: sug }));
                            setSuggestions([]);
                          }}
                          className="w-full text-left px-3 py-3 rounded-lg text-sm hover:bg-brand-bg-sub transition-colors bg-white border border-brand-border min-h-[44px]"
                        >
                          <span>{sug}</span>
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </section>

          {/* Section 3: Advanced Notes */}
          <section className="space-y-4">
            <div className="flex items-center justify-between">
              <Label className="text-base font-semibold leading-none text-brand-text-title">3. Điều khiển AI (Tùy chọn)</Label>
              <span className="text-xs text-brand-text-muted">{state.notes.trim().split(/\s+/).filter(Boolean).length}/100 từ</span>
            </div>
            <Textarea 
              placeholder="Ví dụ: Năng lượng cao, phong cách chuyên gia, biểu cảm hài hước..."
              className="resize-none rounded-[12px] shadow-sm bg-brand-bg-sub border-[1.5px] border-brand-border focus-visible:border-[2px] focus-visible:border-brand-blue focus-visible:ring-0 placeholder:text-brand-placeholder text-brand-text-body"
              rows={2}
              value={state.notes}
              onChange={handleNotesChange}
            />
          </section>

          {/* Section 4: Settings */}
          <section className="grid grid-cols-2 gap-4">
             <div className="space-y-3">
               <Label className="text-sm font-semibold text-brand-text-title">Cảnh quay</Label>
               <div className="flex items-center bg-brand-bg-sub rounded-lg p-1 border border-brand-border">
                 <Button 
                   variant="ghost" 
                   size="icon" 
                   className="h-10 w-10 shrink-0 hover:bg-brand-yellow-light text-brand-blue"
                   onClick={() => setState(s => ({ ...s, sceneCount: Math.max(1, s.sceneCount - 1) }))}
                   disabled={state.sceneCount <= 1}
                 >
                   <Minus className="w-5 h-5" />
                 </Button>
                 <div className="flex-1 text-center font-semibold text-brand-text-title">{state.sceneCount}</div>
                 <Button 
                   variant="ghost" 
                   size="icon" 
                   className="h-10 w-10 shrink-0 hover:bg-brand-yellow-light text-brand-blue"
                   onClick={() => setState(s => ({ ...s, sceneCount: Math.min(7, s.sceneCount + 1) }))}
                   disabled={state.sceneCount >= 7}
                 >
                   <Plus className="w-5 h-5" />
                 </Button>
               </div>
             </div>
             
             <div className="space-y-3">
               <Label className="text-sm font-semibold text-brand-text-title">Giọng đọc</Label>
               <Select value={state.voice} onValueChange={(val: VoiceType) => setState(s => ({ ...s, voice: val }))}>
                  <SelectTrigger className="rounded-[12px] bg-brand-bg-sub border-[1.5px] border-brand-border shadow-none hover:bg-brand-blue-light transition-colors focus:ring-0 focus:border-brand-blue focus:border-[2px] h-[50px] text-brand-text-body font-medium">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-brand-bg-main border-brand-border">
                    <SelectItem value="Bắc">Giọng Bắc</SelectItem>
                    <SelectItem value="Trung">Giọng Trung</SelectItem>
                    <SelectItem value="Nam">Giọng Nam</SelectItem>
                  </SelectContent>
                </Select>
             </div>

             <div className="col-span-2 space-y-3 mt-2">
                <Label className="text-sm font-semibold text-brand-text-title">Model Video (Thời lượng)</Label>
                <div className="grid grid-cols-2 gap-2">
                  {(["Veo 3", "Gork"] as VideoModelType[]).map(v => (
                    <button 
                      key={v}
                      onClick={() => setState(s => ({ ...s, videoModel: v }))}
                      className={`min-h-[44px] px-4 py-3 rounded-[12px] border-2 text-sm font-medium transition-all text-left flex flex-col gap-1 ${state.videoModel === v ? 'border-brand-blue bg-brand-bg-sub' : 'border-brand-border bg-white hover:border-brand-blue hover:bg-brand-bg-sub'}`}
                    >
                      <span className="text-brand-text-title font-bold">{v}</span>
                      <span className="text-xs text-brand-text-muted font-normal">Video {v === 'Veo 3' ? '8' : '10'} giây</span>
                    </button>
                  ))}
                </div>
             </div>
          </section>

          <Button 
            size="lg" 
            className="w-full rounded-[12px] h-14 text-base font-bold bg-brand-yellow hover:bg-brand-yellow-light text-brand-text-title shadow-lg transition-all relative overflow-hidden active:scale-[0.97] hover:scale-[1.03] min-h-[44px]" 
            onClick={handleGenerate}
            disabled={loading}
          >
            {loading ? (
              <motion.div 
                className="absolute inset-0 bg-brand-blue flex items-center justify-center gap-2 text-white"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
              >
                <Wand2 className="w-5 h-5 animate-pulse" />
                <span>AI Đang Phân Tích...</span>
              </motion.div>
            ) : (
              <span className="flex items-center gap-2">
                <Wand2 className="w-5 h-5 text-brand-text-title" />
                Tạo Kịch Bản Video
              </span>
            )}
          </Button>

        </div>

        {/* Right Column: Output & History */}
        <div className="lg:col-span-7 space-y-6">
          <Tabs defaultValue="result" className="w-full">
            <TabsList className="grid w-full grid-cols-2 p-1 bg-brand-bg-sub border border-brand-border rounded-[12px] h-12">
              <TabsTrigger value="result" className="rounded-[8px] data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-brand-blue font-semibold h-full">Kết quả hiện tại</TabsTrigger>
              <TabsTrigger value="history" className="rounded-[8px] data-[state=active]:bg-white data-[state=active]:shadow-sm data-[state=active]:text-brand-blue font-semibold h-full">Lịch sử ({Math.min(3, history.length)})</TabsTrigger>
            </TabsList>
            
            <TabsContent value="result" className="mt-6 outline-none">
              {!currentResult ? (
                <div className="flex flex-col items-center justify-center h-[300px] md:h-[500px] bg-brand-bg-sub border border-dashed border-brand-blue-dark/20 rounded-[16px]">
                  <Play className="w-12 h-12 text-brand-placeholder mb-4" />
                  <p className="text-brand-text-muted font-medium text-center px-4">Nhập thông tin và bấm 'Tạo kịch bản video' để xem kết quả.</p>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Hook & Hashtags */}
                  <Card className="overflow-hidden border border-brand-border shadow-[0_2px_12px_rgba(14,165,233,0.1)] rounded-[16px] bg-white">
                    <div className="bg-brand-bg-sub p-5 border-b border-brand-border flex justify-between items-start gap-4">
                      <div className="flex-1">
                        <h3 className="font-bold text-[16px] mb-2 text-brand-text-title leading-snug">
                          {currentResult.hook}
                        </h3>
                        <div className="flex flex-wrap gap-2">
                          {currentResult.hashtags.map((tag, i) => (
                            <span key={i} className="text-[11px] font-semibold text-[#92400E] bg-brand-yellow-light px-2.5 py-0.5 rounded-full">
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                      <Button variant="outline" size="icon" className="shrink-0 rounded-[12px] w-10 h-10 border-2 border-brand-blue text-brand-blue hover:bg-brand-yellow-light bg-transparent" onClick={() => copyToClipboard(`${currentResult.hook}\n\n${currentResult.hashtags.join(' ')}`, "Hook & Hashtags")}>
                        <Copy className="w-5 h-5" />
                      </Button>
                    </div>
                  </Card>

                  {/* Scenes List */}
                  <div className="space-y-4">
                    <h3 className="font-bold text-lg flex items-center gap-2 text-brand-text-title">
                      <Play className="w-5 h-5 text-brand-blue fill-brand-blue" />
                      Kịch bản chi tiết ({currentResult.scenes.length} cảnh)
                    </h3>
                    
                    {currentResult.scenes.map((scene, idx) => (
                      <Card key={idx} className="rounded-[16px] border border-brand-border shadow-[0_2px_12px_rgba(14,165,233,0.1)] overflow-hidden group flex flex-col">
                        <div className="flex flex-col sm:flex-row flex-1">
                          {/* Video Prompt Area */}
                          <div className="bg-brand-bg-sub text-brand-text-body p-5 sm:w-2/5 flex flex-col relative shrink-0 border-r border-brand-border/50">
                            <div className="flex items-center justify-between mb-3">
                              <Badge variant="outline" className="bg-white text-brand-blue border-brand-blue font-mono text-[11px] font-bold">SCENE {idx + 1}</Badge>
                              <Badge variant="secondary" className="bg-brand-yellow-light text-[#92400E] text-[11px] font-bold">{state.videoModel}</Badge>
                            </div>
                            <p className="text-[14px] leading-relaxed mb-6 font-mono opacity-90">{scene.videoPrompt}</p>
                            
                            <Button variant="ghost" size="sm" className="absolute bottom-2 right-2 hover:bg-brand-yellow-light text-brand-blue min-h-[44px]" onClick={() => copyToClipboard(scene.videoPrompt, `Prompt Cảnh ${idx + 1}`)}>
                              <Copy className="w-4 h-4 mr-1.5" /> Prompt
                            </Button>
                          </div>
                          
                          {/* Voice Script Area */}
                          <div className="bg-white p-5 flex-1 relative flex flex-col justify-center min-h-[140px]">
                            <p className="text-brand-text-body text-[14px] leading-relaxed pl-4 border-l-[3px] border-brand-yellow font-medium">
                              "{scene.voiceScript}"
                            </p>
                            
                            <div className="absolute right-3 top-3 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button variant="ghost" size="icon" className="h-10 w-10 text-brand-blue bg-brand-bg-sub hover:bg-brand-yellow-light rounded-[12px]" onClick={() => copyToClipboard(scene.voiceScript, `Thoại Cảnh ${idx + 1}`)}>
                                <Copy className="w-5 h-5" />
                              </Button>
                            </div>
                          </div>
                        </div>
                        
                        {/* Combined Copy Footer */}
                        <div className="bg-brand-bg-main border-t border-brand-border p-3 sm:px-5 flex justify-end">
                          <Button 
                            className="w-full sm:w-auto bg-brand-yellow hover:bg-brand-yellow-light text-brand-text-title font-bold rounded-[10px] min-h-[44px] shadow-[0_2px_8px_rgba(245,166,35,0.2)] hover:scale-[1.02] active:scale-[0.98] transition-all"
                            onClick={() => {
                              const content = `Prompt Video:\n${scene.videoPrompt}\n\nLời thoại:\n${scene.voiceScript}`;
                              navigator.clipboard.writeText(content);
                              toast.success("Đã copy thành công");
                            }}
                          >
                            <Copy className="w-4 h-4 mr-2" /> Copy Prompt + Lời thoại
                          </Button>
                        </div>
                      </Card>
                    ))}
                  </div>

                  {/* Thumbnails Suggestion */}
                  <div className="space-y-4 pt-4 border-t border-brand-border">
                     <h3 className="font-bold text-lg flex items-center gap-2 text-brand-text-title">
                      <ImagePlus className="w-5 h-5 text-brand-yellow" />
                      Gợi ý Thumbnail
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      {currentResult.thumbnailVariations.map((thumb, idx) => {
                        const refImage = currentResult.inputs.images[currentResult.inputs.selectedImageIndex ?? 0];
                        return (
                          <ThumbnailItem key={idx} thumb={thumb} refImage={refImage} idx={idx} />
                        );
                      })}
                    </div>
                  </div>

                </div>
              )}
            </TabsContent>
            
            {/* History Tab */}
            <TabsContent value="history" className="mt-6 outline-none">
              <div className="space-y-4">
                {history.slice(0, 3).map((item) => (
                  <Card key={item.id} className="p-4 rounded-[16px] shadow-[0_2px_12px_rgba(14,165,233,0.1)] border border-brand-border bg-white hover:border-brand-blue transition-colors">
                    <div className="flex justify-between items-start mb-3 gap-2">
                      <Badge variant="secondary" className="font-semibold text-[11px] text-[#92400E] bg-brand-yellow-light px-2.5">
                        {new Date(item.timestamp).toLocaleString("vi-VN")}
                      </Badge>
                      <div className="flex gap-2 shrink-0">
                         <Button variant="outline" size="sm" className="h-9 min-w-[44px] shadow-none rounded-[8px] border-2 border-brand-blue text-brand-blue hover:bg-brand-yellow-light" onClick={() => applyHistory(item)}>
                            <Edit2 className="w-4 h-4 mr-0 sm:mr-1.5" /> <span className="hidden sm:inline">Chỉnh sửa</span>
                         </Button>
                         <Button variant="default" size="sm" className="h-9 min-w-[44px] shadow-none bg-brand-yellow text-brand-text-title hover:bg-brand-yellow-light rounded-[8px] font-bold" onClick={() => {
                            navigator.clipboard.writeText(item.scenes.map(s => `Prompt: ${s.videoPrompt}\nThoại: ${s.voiceScript}`).join('\n\n'));
                            toast.success("Đã copy nhanh toàn bộ kịch bản!");
                         }}>
                            <Copy className="w-4 h-4 mr-0 sm:mr-1.5" /> <span className="hidden sm:inline">Copy</span>
                         </Button>
                      </div>
                    </div>
                    <h4 className="font-bold text-brand-text-title line-clamp-1 mb-1 text-[16px]">{item.hook}</h4>
                    <p className="text-[14px] text-brand-text-body line-clamp-2">{item.inputs.content}</p>
                    <div className="mt-3 flex gap-2">
                       <Badge variant="outline" className="border-brand-blue text-brand-blue">{item.scenes.length} cảnh</Badge>
                       <Badge variant="outline" className="border-brand-blue text-brand-blue">{item.inputs.videoModel}</Badge>
                    </div>
                  </Card>
                ))}
                
                {history.length === 0 && (
                  <div className="text-center py-12 text-brand-text-muted bg-brand-bg-sub rounded-[16px] border border-brand-border border-dashed">
                    <p className="font-medium">Chưa có lịch sử tạo kịch bản trong 24h qua.</p>
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </main>

      {/* Bottom Navigation (Mobile) */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-brand-border z-50 md:hidden pb-safe">
        <div className="flex items-center justify-around h-16">
          <Tabs defaultValue="result" className="w-full flex h-full" value={currentResult ? "result" : "history"} onValueChange={() => {}}>
            <button className="flex flex-col items-center justify-center w-full h-full space-y-1 text-brand-blue group cursor-pointer" onClick={() => { window.scrollTo({top: 0, behavior: 'smooth'}); }}>
              <div className="relative">
                <Sparkles className="w-[22px] h-[22px] stroke-[2.5px]" />
                <div className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-brand-yellow border-2 border-white"></div>
              </div>
              <span className="text-[11px] font-bold text-brand-yellow">Tạo kịch bản</span>
            </button>
            
            <button className="flex flex-col items-center justify-center w-full h-full space-y-1 text-brand-placeholder hover:text-brand-blue transition-colors cursor-pointer" onClick={() => {
              const tabsTriggers = document.querySelectorAll('[role="tab"]');
              tabsTriggers.forEach(t => {
                if(t.getAttribute("value") === "history") (t as HTMLElement).click();
              });
              window.scrollTo({top: 0, behavior: 'smooth'});
            }}>
              <History className="w-[22px] h-[22px] stroke-[2.5px]" />
              <span className="text-[11px] font-medium">Lịch sử</span>
            </button>
          </Tabs>
        </div>
      </nav>

    </div>
  );
}
