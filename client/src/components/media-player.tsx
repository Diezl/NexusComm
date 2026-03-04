import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import Hls from "hls.js";
import mpegts from "mpegts.js";
import flvjs from "flv.js";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Play, Pause, Volume2, VolumeX, Maximize2, Minimize2,
  SkipBack, SkipForward, X, FolderOpen, Link2,
  ListVideo, ChevronRight, Repeat, Shuffle, RefreshCw, Radio,
  Search, Layers, ChevronDown, Save, Download, BookOpen,
  Trash2, Check, AlertCircle,
} from "lucide-react";

type MediaItem = {
  id: string;
  url: string;
  name: string;
  type: "local" | "url";
  streamType?: "hls" | "mp4" | "webm" | "audio" | "mpegts" | "flv" | "other";
  group?: string;
  logo?: string;
};

type ServerPlaylist = {
  id: string;
  userId: string;
  name: string;
  items: MediaItem[];
  itemCount: number;
  createdAt: string | null;
};

const ITEM_HEIGHT = 40;
const OVERSCAN = 8;
const LS_AUTOSAVE = "nexuscomm_playlist_auto";
const LS_INDEX = "nexuscomm_playlist_index";

function lsGet<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch { return fallback; }
}

function lsSet(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch { return false; }
}

function formatTime(sec: number): string {
  if (!isFinite(sec) || isNaN(sec)) return "--:--";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function detectStreamType(url: string): MediaItem["streamType"] {
  const lower = url.toLowerCase().split("?")[0];
  if (lower.endsWith(".m3u8") || lower.includes(".m3u8")) return "hls";
  if (lower.endsWith(".ts") || lower.includes("/ts/") || lower.endsWith(".mts") || lower.endsWith(".m2ts")) return "mpegts";
  if (lower.endsWith(".flv")) return "flv";
  if (lower.endsWith(".mp4") || lower.endsWith(".mov") || lower.endsWith(".mkv") || lower.endsWith(".avi")) return "mp4";
  if (lower.endsWith(".webm")) return "webm";
  if (lower.endsWith(".mp3") || lower.endsWith(".aac") || lower.endsWith(".wav") || lower.endsWith(".flac") || lower.endsWith(".ogg") || lower.endsWith(".opus")) return "audio";
  return "other";
}

function isHlsStream(url: string): boolean { return detectStreamType(url) === "hls"; }
function isMpegtsStream(url: string): boolean { return detectStreamType(url) === "mpegts"; }
function isFlvStream(url: string): boolean { return detectStreamType(url) === "flv"; }
function isM3uFile(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith(".m3u") || lower.endsWith(".m3u8");
}

function parseM3U(content: string, baseUrl?: string): MediaItem[] {
  const lines = content.split(/\r?\n/);
  const items: MediaItem[] = [];
  let pendingName: string | null = null;
  let pendingGroup: string | null = null;
  let pendingLogo: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (line.startsWith("#EXTINF:")) {
      pendingName = line.match(/tvg-name="([^"]+)"/)?.[1] || line.match(/#EXTINF:[^,]*,(.+)/)?.[1]?.trim() || null;
      pendingGroup = line.match(/group-title="([^"]+)"/)?.[1] || null;
      pendingLogo = line.match(/tvg-logo="([^"]+)"/)?.[1] || null;
      continue;
    }
    if (line.startsWith("#EXT-X-STREAM-INF:")) {
      const next = lines[i + 1]?.trim();
      if (next && !next.startsWith("#")) {
        const url = resolveUrl(next, baseUrl);
        items.push({ id: `m3u-${i}-${Math.random().toString(36).slice(2, 7)}`, url, name: pendingName || extractName(next), type: "url", streamType: detectStreamType(url), group: pendingGroup || undefined, logo: pendingLogo || undefined });
        pendingName = null; pendingGroup = null; pendingLogo = null;
        i++;
      }
      continue;
    }
    if (line.startsWith("#")) continue;

    const url = resolveUrl(line, baseUrl);
    items.push({ id: `m3u-${i}-${Math.random().toString(36).slice(2, 7)}`, url, name: pendingName || extractName(line), type: "url", streamType: detectStreamType(url), group: pendingGroup || undefined, logo: pendingLogo || undefined });
    pendingName = null; pendingGroup = null; pendingLogo = null;
  }
  return items;
}

function generateM3U(items: MediaItem[]): string {
  const lines = ["#EXTM3U"];
  for (const item of items) {
    const attrs = [
      item.logo ? `tvg-logo="${item.logo}"` : "",
      item.group ? `group-title="${item.group}"` : "",
    ].filter(Boolean).join(" ");
    lines.push(`#EXTINF:-1 ${attrs},${item.name}`);
    lines.push(item.url);
  }
  return lines.join("\n");
}

function resolveUrl(url: string, base?: string): string {
  if (!base || url.startsWith("http://") || url.startsWith("https://") || url.startsWith("//")) return url;
  try { return new URL(url, base).href; } catch { return url; }
}

function extractName(url: string): string {
  try { return url.split("/").pop()?.split("?")[0] || url; } catch { return url; }
}

function StreamTypeBadge({ type }: { type?: MediaItem["streamType"] }) {
  if (!type || type === "other" || type === "mp4" || type === "webm") return null;
  const map: Record<string, { label: string; cls: string }> = {
    hls: { label: "HLS", cls: "bg-orange-500/20 text-orange-400 border-orange-500/30" },
    mpegts: { label: "TS", cls: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30" },
    flv: { label: "FLV", cls: "bg-pink-500/20 text-pink-400 border-pink-500/30" },
    audio: { label: "AUDIO", cls: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  };
  const m = map[type];
  if (!m) return null;
  return <span className={`text-[9px] px-1 py-0.5 rounded border font-mono font-bold tracking-wider ${m.cls}`}>{m.label}</span>;
}

function VirtualList({ items, currentIndex, isPlaying, onPlay, onRemove }: {
  items: { item: MediaItem; originalIndex: number }[];
  currentIndex: number;
  isPlaying: boolean;
  onPlay: (i: number) => void;
  onRemove: (id: string, i: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(400);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContainerHeight(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => setScrollTop(el.scrollTop);
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || currentIndex < 0) return;
    const idx = items.findIndex(i => i.originalIndex === currentIndex);
    if (idx < 0) return;
    const itemTop = idx * ITEM_HEIGHT;
    if (itemTop < el.scrollTop || itemTop + ITEM_HEIGHT > el.scrollTop + el.clientHeight) {
      el.scrollTop = Math.max(0, itemTop - el.clientHeight / 2 + ITEM_HEIGHT / 2);
    }
  }, [currentIndex, items]);

  const visibleCount = Math.ceil(containerHeight / ITEM_HEIGHT);
  const startIdx = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - OVERSCAN);
  const endIdx = Math.min(items.length, startIdx + visibleCount + OVERSCAN * 2);
  const totalHeight = items.length * ITEM_HEIGHT;
  const topOffset = startIdx * ITEM_HEIGHT;

  return (
    <div ref={containerRef} className="flex-1 overflow-y-auto overflow-x-hidden" style={{ position: "relative" }}>
      <div style={{ height: totalHeight, position: "relative" }}>
        <div style={{ position: "absolute", top: topOffset, left: 0, right: 0 }}>
          {items.slice(startIdx, endIdx).map(({ item, originalIndex }) => {
            const isActive = originalIndex === currentIndex;
            return (
              <div key={item.id} className={`flex items-center gap-1.5 px-2 cursor-pointer group hover:bg-accent/50 transition-colors ${isActive ? "bg-accent" : ""}`}
                style={{ height: ITEM_HEIGHT }} onClick={() => onPlay(originalIndex)} title={item.name}>
                <div className="w-3 h-3 shrink-0 flex items-center justify-center">
                  {isActive
                    ? isPlaying
                      ? <span className="flex gap-0.5">{[0, 1, 2].map(i => <span key={i} className="w-0.5 h-3 bg-primary rounded animate-pulse" style={{ animationDelay: `${i * 0.15}s` }} />)}</span>
                      : <ChevronRight className="w-3 h-3 text-primary" />
                    : <span className="text-[10px] text-muted-foreground/40 font-mono">{originalIndex + 1}</span>}
                </div>
                {item.logo && <img src={item.logo} alt="" className="w-5 h-5 rounded object-contain shrink-0 bg-muted" onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />}
                <div className="flex-1 min-w-0">
                  <p className={`text-xs truncate leading-tight ${isActive ? "text-primary font-medium" : ""}`}>{item.name}</p>
                  {item.group && !isActive && <p className="text-[10px] text-muted-foreground/60 truncate leading-tight">{item.group}</p>}
                  {isActive && <StreamTypeBadge type={item.streamType} />}
                </div>
                <button className="opacity-0 group-hover:opacity-100 shrink-0" onClick={e => { e.stopPropagation(); onRemove(item.id, originalIndex); }}>
                  <X className="w-3 h-3 text-muted-foreground hover:text-destructive" />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function MediaPlayer() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const mpegtsRef = useRef<ReturnType<typeof mpegts.createPlayer> | null>(null);
  const flvRef = useRef<ReturnType<typeof flvjs.createPlayer> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [playlist, setPlaylist] = useState<MediaItem[]>(() =>
    lsGet<MediaItem[]>(LS_AUTOSAVE, []).filter(i => i.type === "url")
  );
  const [currentIndex, setCurrentIndex] = useState<number>(() =>
    lsGet<number>(LS_INDEX, -1)
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showPlaylist, setShowPlaylist] = useState(true);
  const [urlInput, setUrlInput] = useState("");
  const [urlName, setUrlName] = useState("");
  const [isLooping, setIsLooping] = useState(false);
  const [isShuffling, setIsShuffling] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isBuffering, setIsBuffering] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [hlsLevel, setHlsLevel] = useState<number>(-1);
  const [hlsLevels, setHlsLevels] = useState<{ height: number; bitrate: number }[]>([]);
  const [loadingM3u, setLoadingM3u] = useState(false);
  const [loadProgress, setLoadProgress] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeGroup, setActiveGroup] = useState<string>("__all__");
  const [showGroupMenu, setShowGroupMenu] = useState(false);

  const { data: savedPlaylists = [] } = useQuery<ServerPlaylist[]>({
    queryKey: ["/api/media/playlists"],
  });
  const [showSavedPanel, setShowSavedPanel] = useState(false);
  const [saveNameInput, setSaveNameInput] = useState("");
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "error">("idle");

  const currentItem = currentIndex >= 0 ? playlist[currentIndex] : null;
  const playlistRef = useRef(playlist);
  playlistRef.current = playlist;
  const currentIndexRef = useRef(currentIndex);
  currentIndexRef.current = currentIndex;
  const isLoopingRef = useRef(isLooping);
  isLoopingRef.current = isLooping;
  const isShufflingRef = useRef(isShuffling);
  isShufflingRef.current = isShuffling;

  useEffect(() => {
    const urlItems = playlist.filter(i => i.type === "url");
    lsSet(LS_AUTOSAVE, urlItems);
    lsSet(LS_INDEX, currentIndex);
  }, [playlist, currentIndex]);

  const groups = useMemo(() => {
    const seen = new Set<string>();
    for (const item of playlist) { if (item.group) seen.add(item.group); }
    return Array.from(seen).sort();
  }, [playlist]);

  const filteredWithIndex = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return playlist.map((item, originalIndex) => ({ item, originalIndex })).filter(({ item }) => {
      const groupMatch = activeGroup === "__all__" || item.group === activeGroup;
      const searchMatch = !q || item.name.toLowerCase().includes(q) || (item.group || "").toLowerCase().includes(q);
      return groupMatch && searchMatch;
    });
  }, [playlist, searchQuery, activeGroup]);

  const playItem = useCallback((index: number) => {
    const list = playlistRef.current;
    if (index < 0 || index >= list.length) return;
    setCurrentIndex(index);
    setError(null); setIsLive(false); setHlsLevels([]); setHlsLevel(-1);
  }, []);

  const destroyAll = useCallback(() => {
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    if (mpegtsRef.current) { try { mpegtsRef.current.pause(); mpegtsRef.current.unload(); mpegtsRef.current.detachMediaElement(); mpegtsRef.current.destroy(); } catch {} mpegtsRef.current = null; }
    if (flvRef.current) { try { flvRef.current.pause(); flvRef.current.unload(); flvRef.current.detachMediaElement(); flvRef.current.destroy(); } catch {} flvRef.current = null; }
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !currentItem) return;
    setCurrentTime(0); setDuration(0);
    destroyAll();

    const type = currentItem.streamType;

    if (type === "hls") {
      if (Hls.isSupported()) {
        const hls = new Hls({ enableWorker: true, lowLatencyMode: false, backBufferLength: 90 });
        hlsRef.current = hls;
        hls.loadSource(currentItem.url);
        hls.attachMedia(v);
        hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
          setHlsLevels(data.levels.map(l => ({ height: l.height, bitrate: l.bitrate })));
          setHlsLevel(hls.currentLevel);
          v.play().catch(() => setIsPlaying(false));
        });
        hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => setHlsLevel(data.level));
        hls.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) {
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
            else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
            else setError("HLS stream error. Check the URL and try again.");
          }
        });
      } else if (v.canPlayType("application/vnd.apple.mpegurl")) {
        v.src = currentItem.url; v.load(); v.play().catch(() => setIsPlaying(false));
      } else {
        setError("HLS is not supported in this browser.");
      }
    } else if (type === "mpegts" && mpegts.isSupported()) {
      try {
        const player = mpegts.createPlayer({ type: "mpegts", url: currentItem.url, isLive: true }, { enableWorker: true, lazyLoadMaxDuration: 3 * 60 });
        mpegtsRef.current = player;
        player.attachMediaElement(v);
        player.load();
        player.play().catch(() => setIsPlaying(false));
        player.on(mpegts.Events.ERROR, (_type: string, _info: any) => {
          setError("MPEG-TS stream error.");
        });
      } catch {
        v.src = currentItem.url; v.load(); v.play().catch(() => setIsPlaying(false));
      }
    } else if (type === "flv" && flvjs.isSupported()) {
      try {
        const player = flvjs.createPlayer({ type: "flv", url: currentItem.url });
        flvRef.current = player;
        player.attachMediaElement(v);
        player.load();
        player.play().catch(() => setIsPlaying(false));
        player.on(flvjs.Events.ERROR, () => {
          setError("FLV stream error.");
        });
      } catch {
        v.src = currentItem.url; v.load(); v.play().catch(() => setIsPlaying(false));
      }
    } else {
      v.src = currentItem.url; v.load(); v.play().catch(() => setIsPlaying(false));
    }
    return () => { destroyAll(); };
  }, [currentItem?.url, destroyAll]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTimeUpdate = () => setCurrentTime(v.currentTime);
    const onDuration = () => { setDuration(v.duration); setIsLive(!isFinite(v.duration)); };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      if (isLoopingRef.current) { v.play(); return; }
      const list = playlistRef.current;
      const idx = currentIndexRef.current;
      const next = isShufflingRef.current ? Math.floor(Math.random() * list.length) : idx + 1;
      if (next < list.length) playItem(next); else setIsPlaying(false);
    };
    const onWaiting = () => setIsBuffering(true);
    const onCanPlay = () => setIsBuffering(false);
    const onError = () => { if (!hlsRef.current && !mpegtsRef.current && !flvRef.current) setError("Cannot play this file."); };
    v.addEventListener("timeupdate", onTimeUpdate);
    v.addEventListener("durationchange", onDuration);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("ended", onEnded);
    v.addEventListener("waiting", onWaiting);
    v.addEventListener("canplay", onCanPlay);
    v.addEventListener("error", onError);
    return () => {
      v.removeEventListener("timeupdate", onTimeUpdate);
      v.removeEventListener("durationchange", onDuration);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("ended", onEnded);
      v.removeEventListener("waiting", onWaiting);
      v.removeEventListener("canplay", onCanPlay);
      v.removeEventListener("error", onError);
    };
  }, [playItem]);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v || !currentItem) return;
    if (isPlaying) v.pause(); else v.play();
  };

  const seek = (val: number[]) => {
    const v = videoRef.current;
    if (!v || isLive) return;
    v.currentTime = val[0]; setCurrentTime(val[0]);
  };

  const changeVolume = (val: number[]) => {
    const v = videoRef.current;
    const vol = val[0];
    setVolume(vol); setIsMuted(vol === 0);
    if (v) { v.volume = vol; v.muted = vol === 0; }
  };

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    const next = !isMuted; setIsMuted(next); v.muted = next;
  };

  const skipRelative = (sec: number) => {
    const v = videoRef.current;
    if (!v || isLive) return;
    v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + sec));
  };

  const toggleFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) el.requestFullscreen();
    else document.exitFullscreen();
  };

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const processM3uContent = useCallback((content: string, baseUrl?: string) => {
    const items = parseM3U(content, baseUrl);
    if (items.length === 0) return 0;
    setPlaylist(prev => {
      const wasEmpty = prev.length === 0;
      const next = [...prev, ...items];
      if (wasEmpty) setCurrentIndex(0);
      return next;
    });
    return items.length;
  }, []);

  const addLocalFiles = async (files: FileList | null) => {
    if (!files) return;
    const regular: MediaItem[] = [];
    for (const f of Array.from(files)) {
      if (isM3uFile(f.name)) {
        setLoadingM3u(true); setLoadProgress(`Reading ${f.name}…`);
        try {
          const count = processM3uContent(await f.text(), URL.createObjectURL(f));
          if (count === 0) setError(`No entries in ${f.name}`);
          else { setLoadProgress(`✓ ${count.toLocaleString()} channels`); setTimeout(() => setLoadProgress(null), 3000); }
        } catch { setError(`Failed to read ${f.name}`); }
        finally { setLoadingM3u(false); }
      } else {
        regular.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, url: URL.createObjectURL(f), name: f.name, type: "local", streamType: detectStreamType(f.name) });
      }
    }
    if (regular.length > 0) {
      setPlaylist(prev => {
        const wasEmpty = prev.length === 0;
        const next = [...prev, ...regular];
        if (wasEmpty) setCurrentIndex(0);
        return next;
      });
    }
  };

  const addUrl = async () => {
    if (!urlInput.trim()) return;
    const rawUrl = urlInput.trim();
    const lower = rawUrl.toLowerCase().split("?")[0];
    if (lower.endsWith(".m3u") || lower.endsWith(".m3u8") || lower.includes(".m3u")) {
      setLoadingM3u(true); setLoadProgress("Fetching playlist…");
      try {
        const res = await fetch(rawUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        setLoadProgress("Parsing channels…");
        await new Promise(r => setTimeout(r, 10));
        const count = processM3uContent(text, rawUrl);
        if (count === 0) {
          const item: MediaItem = { id: `${Date.now()}`, url: rawUrl, name: urlName.trim() || extractName(rawUrl), type: "url", streamType: "hls" };
          setPlaylist(prev => { const wasEmpty = prev.length === 0; const next = [...prev, item]; if (wasEmpty) setCurrentIndex(0); return next; });
          setLoadProgress("Added as stream");
        } else {
          setLoadProgress(`✓ ${count.toLocaleString()} channels loaded`);
        }
        setTimeout(() => setLoadProgress(null), 4000);
      } catch {
        setLoadProgress(null);
        const item: MediaItem = { id: `${Date.now()}`, url: rawUrl, name: urlName.trim() || extractName(rawUrl), type: "url", streamType: detectStreamType(rawUrl) };
        setPlaylist(prev => { const wasEmpty = prev.length === 0; const next = [...prev, item]; if (wasEmpty) setCurrentIndex(0); return next; });
      } finally { setLoadingM3u(false); }
    } else {
      const item: MediaItem = { id: `${Date.now()}`, url: rawUrl, name: urlName.trim() || extractName(rawUrl), type: "url", streamType: detectStreamType(rawUrl) };
      setPlaylist(prev => { const wasEmpty = prev.length === 0; const next = [...prev, item]; if (wasEmpty) setCurrentIndex(0); return next; });
    }
    setUrlInput(""); setUrlName(""); setShowUrlInput(false);
  };

  const removeItem = (id: string, idx: number) => {
    setPlaylist(prev => prev.filter(p => p.id !== id));
    if (idx === currentIndex) {
      destroyAll(); setCurrentIndex(-1);
      if (videoRef.current) videoRef.current.src = "";
      setIsPlaying(false); setCurrentTime(0); setDuration(0); setIsLive(false);
    } else if (idx < currentIndex) {
      setCurrentIndex(i => i - 1);
    }
  };

  const clearAll = () => {
    destroyAll(); setPlaylist([]); setCurrentIndex(-1);
    if (videoRef.current) videoRef.current.src = "";
    setIsPlaying(false); setIsLive(false);
    setSearchQuery(""); setActiveGroup("__all__");
    lsSet(LS_AUTOSAVE, []); lsSet(LS_INDEX, -1);
  };

  const saveMutation = useMutation({
    mutationFn: async ({ name, items }: { name: string; items: MediaItem[] }) =>
      apiRequest("POST", "/api/media/playlists", { name, items }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/media/playlists"] });
      setSaveNameInput(""); setShowSaveInput(false);
      setSaveStatus("saved"); setTimeout(() => setSaveStatus("idle"), 2000);
    },
    onError: () => {
      setSaveStatus("error"); setTimeout(() => setSaveStatus("idle"), 2000);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/media/playlists/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/media/playlists"] }),
  });

  const saveCurrentPlaylist = () => {
    const name = saveNameInput.trim() || `Playlist ${new Date().toLocaleDateString()}`;
    const urlItems = playlist.filter(i => i.type === "url");
    if (urlItems.length === 0) { setSaveStatus("error"); setTimeout(() => setSaveStatus("idle"), 2000); return; }
    saveMutation.mutate({ name, items: urlItems });
  };

  const loadSavedPlaylist = (pl: ServerPlaylist) => {
    destroyAll();
    if (videoRef.current) videoRef.current.src = "";
    setPlaylist(pl.items as MediaItem[]);
    setCurrentIndex(pl.items.length > 0 ? 0 : -1);
    setIsPlaying(false); setIsLive(false);
    setSearchQuery(""); setActiveGroup("__all__");
    setShowSavedPanel(false);
    setLoadProgress(`✓ Loaded "${pl.name}" — ${pl.items.length.toLocaleString()} channels`);
    setTimeout(() => setLoadProgress(null), 3000);
  };

  const deleteSavedPlaylist = (id: string) => {
    deleteMutation.mutate(id);
  };

  const exportM3U = () => {
    const urlItems = playlist.filter(i => i.type === "url");
    if (urlItems.length === 0) return;
    const content = generateM3U(urlItems);
    const a = document.createElement("a");
    a.href = `data:audio/x-mpegurl;charset=utf-8,${encodeURIComponent(content)}`;
    a.download = `nexuscomm-playlist-${Date.now()}.m3u`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const switchQuality = (level: number) => {
    if (hlsRef.current) hlsRef.current.currentLevel = level;
  };

  const nextItem = () => {
    if (filteredWithIndex.length === 0) return;
    const curPos = filteredWithIndex.findIndex(f => f.originalIndex === currentIndex);
    const nextPos = curPos < 0 ? 0 : (curPos + 1) % filteredWithIndex.length;
    playItem(filteredWithIndex[nextPos].originalIndex);
  };

  const prevItem = () => {
    if (filteredWithIndex.length === 0) return;
    const curPos = filteredWithIndex.findIndex(f => f.originalIndex === currentIndex);
    const prevPos = curPos <= 0 ? filteredWithIndex.length - 1 : curPos - 1;
    playItem(filteredWithIndex[prevPos].originalIndex);
  };

  return (
    <div className="flex flex-col h-full bg-background" ref={containerRef}>
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
        <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0" style={{ background: "linear-gradient(135deg, #FF8C00, #FF4500)" }}>
          <div className="w-2.5 h-2.5 rounded-full bg-white/90" />
        </div>
        <h2 className="font-semibold text-sm">Media Player</h2>
        <div className="flex gap-1 ml-1">
          <Badge variant="secondary" className="text-xs">VLC-style</Badge>
          <Badge variant="outline" className="text-xs text-orange-500 border-orange-500/40">HLS</Badge>
          <Badge variant="outline" className="text-xs text-cyan-500 border-cyan-500/40">TS</Badge>
          <Badge variant="outline" className="text-xs text-pink-500 border-pink-500/40">FLV</Badge>
          <Badge variant="outline" className="text-xs text-blue-500 border-blue-500/40">M3U</Badge>
        </div>
        {isLive && (
          <div className="flex items-center gap-1 ml-auto">
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-xs font-medium text-red-500">LIVE</span>
          </div>
        )}
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Video + controls */}
        <div className="flex flex-col flex-1 min-w-0">
          <div className="relative flex-1 bg-black flex items-center justify-center min-h-0 overflow-hidden">
            <video ref={videoRef} className="max-w-full max-h-full object-contain" style={{ width: "100%", height: "100%" }} onClick={togglePlay} data-testid="media-player-video" />
            {!currentItem && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/50 pointer-events-none select-none">
                <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: "rgba(255,140,0,0.15)" }}>
                  <Play className="w-8 h-8" style={{ color: "#FF8C00" }} />
                </div>
                <p className="text-sm">Load an M3U playlist or add a stream</p>
                <div className="flex gap-2 text-xs flex-wrap justify-center">
                  <span className="px-2 py-0.5 rounded bg-white/10">mp4 / webm / mkv</span>
                  <span className="px-2 py-0.5 rounded bg-orange-500/20 text-orange-400">HLS .m3u8</span>
                  <span className="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-400">MPEG-TS .ts</span>
                  <span className="px-2 py-0.5 rounded bg-pink-500/20 text-pink-400">FLV</span>
                  <span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-400">M3U playlist</span>
                </div>
              </div>
            )}
            {isBuffering && currentItem && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 pointer-events-none">
                <RefreshCw className="w-8 h-8 text-white animate-spin" />
              </div>
            )}
            {error && (
              <div className="absolute bottom-4 left-4 right-4 bg-destructive/90 text-destructive-foreground text-xs rounded-md p-2 text-center">
                {error}
              </div>
            )}
            {hlsLevels.length > 1 && (
              <div className="absolute top-2 right-2 flex flex-col gap-1">
                {hlsLevels.map((l, i) => (
                  <button key={i} onClick={() => switchQuality(i)} data-testid={`media-quality-${i}`}
                    className={`text-xs px-2 py-0.5 rounded font-mono ${hlsLevel === i ? "bg-orange-500 text-white" : "bg-black/60 text-white/70 hover:bg-black/80"}`}>
                    {l.height > 0 ? `${l.height}p` : `Q${i}`}
                  </button>
                ))}
                <button onClick={() => switchQuality(-1)} data-testid="media-quality-auto"
                  className={`text-xs px-2 py-0.5 rounded font-mono ${hlsLevel === -1 ? "bg-orange-500 text-white" : "bg-black/60 text-white/70 hover:bg-black/80"}`}>Auto</button>
              </div>
            )}
          </div>

          {currentItem && (
            <div className="px-4 py-1.5 text-xs border-t border-border shrink-0 flex items-center gap-2">
              {isLive && <Radio className="w-3 h-3 text-red-500 animate-pulse shrink-0" />}
              <span className="font-medium text-foreground truncate">{currentItem.name}</span>
              {currentItem.group && <span className="text-muted-foreground shrink-0">— {currentItem.group}</span>}
              <StreamTypeBadge type={currentItem.streamType} />
            </div>
          )}

          <div className="px-3 pt-2 pb-0 shrink-0">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <span data-testid="media-current-time">{isLive ? "LIVE" : formatTime(currentTime)}</span>
              <div className="flex-1">
                {isLive ? (
                  <div className="h-1 rounded-full bg-red-500/30 relative overflow-hidden">
                    <div className="absolute inset-0 bg-red-500/60 animate-pulse" />
                  </div>
                ) : (
                  <Slider data-testid="media-progress-slider" min={0} max={duration || 1} step={0.5} value={[currentTime]} onValueChange={seek} className="h-1" />
                )}
              </div>
              <span data-testid="media-duration">{isLive ? "∞" : formatTime(duration)}</span>
            </div>
          </div>

          <div className="flex items-center justify-between px-3 py-2 shrink-0 gap-1">
            <div className="flex items-center gap-1">
              <Button size="icon" variant="ghost" className="w-7 h-7" data-testid="media-btn-loop" onClick={() => setIsLooping(l => !l)} title="Loop">
                <Repeat className={`w-3.5 h-3.5 ${isLooping ? "text-primary" : "text-muted-foreground"}`} />
              </Button>
              <Button size="icon" variant="ghost" className="w-7 h-7" data-testid="media-btn-shuffle" onClick={() => setIsShuffling(s => !s)} title="Shuffle">
                <Shuffle className={`w-3.5 h-3.5 ${isShuffling ? "text-primary" : "text-muted-foreground"}`} />
              </Button>
            </div>

            <div className="flex items-center gap-1">
              <Button size="icon" variant="ghost" className="w-8 h-8" data-testid="media-btn-prev" onClick={prevItem} disabled={!currentItem} title="Previous">
                <SkipBack className="w-4 h-4" />
              </Button>
              <Button size="icon" variant="ghost" className="w-8 h-8" data-testid="media-btn-rewind" onClick={() => skipRelative(-10)} disabled={!currentItem || isLive} title="Rewind 10s">
                <SkipBack className="w-3.5 h-3.5 text-muted-foreground" />
              </Button>
              <Button size="icon" variant="default" className="w-9 h-9 rounded-full" data-testid="media-btn-playpause"
                onClick={togglePlay} disabled={!currentItem}
                style={{ background: currentItem ? "#FF8C00" : undefined, color: "white" }}
                title={isPlaying ? "Pause" : "Play"}>
                {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              </Button>
              <Button size="icon" variant="ghost" className="w-8 h-8" data-testid="media-btn-forward" onClick={() => skipRelative(10)} disabled={!currentItem || isLive} title="Forward 10s">
                <SkipForward className="w-3.5 h-3.5 text-muted-foreground" />
              </Button>
              <Button size="icon" variant="ghost" className="w-8 h-8" data-testid="media-btn-next" onClick={nextItem} disabled={!currentItem} title="Next">
                <SkipForward className="w-4 h-4" />
              </Button>
            </div>

            <div className="flex items-center gap-1.5">
              <Button size="icon" variant="ghost" className="w-7 h-7" data-testid="media-btn-mute" onClick={toggleMute}>
                {isMuted || volume === 0 ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
              </Button>
              <div className="w-16">
                <Slider data-testid="media-volume-slider" min={0} max={1} step={0.05} value={[isMuted ? 0 : volume]} onValueChange={changeVolume} className="h-1" />
              </div>
              <Button size="icon" variant="ghost" className="w-7 h-7" data-testid="media-btn-fullscreen" onClick={toggleFullscreen}>
                {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
              </Button>
              <Button size="icon" variant="ghost" className="w-7 h-7" data-testid="media-btn-playlist-toggle" onClick={() => setShowPlaylist(p => !p)}>
                <ListVideo className={`w-3.5 h-3.5 ${showPlaylist ? "text-primary" : ""}`} />
              </Button>
            </div>
          </div>
        </div>

        {/* Playlist panel */}
        {showPlaylist && (
          <div className="w-72 border-l border-border flex flex-col shrink-0">
            {/* Panel header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Playlist
                {playlist.length > 0 && (
                  <span className="ml-1.5 text-foreground">
                    {filteredWithIndex.length !== playlist.length
                      ? `${filteredWithIndex.length.toLocaleString()} / ${playlist.length.toLocaleString()}`
                      : playlist.length.toLocaleString()}
                  </span>
                )}
              </span>
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" className="w-6 h-6" onClick={() => fileInputRef.current?.click()} title="Open file / M3U" data-testid="media-btn-add-file">
                  <FolderOpen className="w-3 h-3" />
                </Button>
                <Button size="icon" variant="ghost" className="w-6 h-6" onClick={() => setShowUrlInput(u => !u)} title="Load URL or M3U" data-testid="media-btn-add-url">
                  <Link2 className="w-3 h-3" />
                </Button>
                <Button size="icon" variant="ghost" className={`w-6 h-6 ${showSavedPanel ? "text-primary" : ""}`} onClick={() => setShowSavedPanel(s => !s)} title="Saved playlists" data-testid="media-btn-saved-playlists">
                  <BookOpen className="w-3 h-3" />
                </Button>
                <Button size="icon" variant="ghost" className="w-6 h-6" onClick={exportM3U} disabled={playlist.filter(i => i.type === "url").length === 0} title="Export playlist as .m3u" data-testid="media-btn-export">
                  <Download className="w-3 h-3" />
                </Button>
                <Button size="icon" variant="ghost" className="w-6 h-6" onClick={clearAll} title="Clear all" data-testid="media-btn-clear-playlist">
                  <X className="w-3 h-3" />
                </Button>
              </div>
            </div>

            {/* Saved playlists panel */}
            {showSavedPanel && (
              <div className="border-b border-border bg-muted/20 shrink-0">
                <div className="px-3 py-2 flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Saved Playlists</span>
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-xs gap-1" onClick={() => setShowSaveInput(s => !s)} data-testid="media-btn-save-current">
                    <Save className="w-3 h-3" />
                    Save current
                  </Button>
                </div>
                {showSaveInput && (
                  <div className="px-3 pb-2 flex gap-1.5">
                    <Input className="h-7 text-xs flex-1" placeholder="Playlist name…" value={saveNameInput}
                      onChange={e => setSaveNameInput(e.target.value)}
                      onKeyDown={e => e.key === "Enter" && saveCurrentPlaylist()}
                      data-testid="media-input-save-name" />
                    <Button size="sm" className="h-7 px-2" onClick={saveCurrentPlaylist} style={{ background: "#FF8C00" }} data-testid="media-btn-save-confirm">
                      {saveStatus === "saved" ? <Check className="w-3 h-3" /> : saveStatus === "error" ? <AlertCircle className="w-3 h-3" /> : <Save className="w-3 h-3" />}
                    </Button>
                  </div>
                )}
                {savedPlaylists.length === 0 ? (
                  <p className="text-xs text-muted-foreground/60 text-center py-3 italic">No saved playlists</p>
                ) : (
                  <div className="max-h-48 overflow-y-auto">
                    {savedPlaylists.map(pl => (
                      <div key={pl.id} className="flex items-center gap-2 px-3 py-2 hover:bg-accent/50 group" data-testid={`saved-playlist-${pl.id}`}>
                        <button className="flex-1 min-w-0 text-left" onClick={() => loadSavedPlaylist(pl)}>
                          <p className="text-xs font-medium truncate">{pl.name}</p>
                          <p className="text-[10px] text-muted-foreground">{pl.itemCount.toLocaleString()} channels · {pl.createdAt ? new Date(pl.createdAt).toLocaleDateString() : ""}</p>
                        </button>
                        <button className="opacity-0 group-hover:opacity-100 shrink-0" onClick={() => deleteSavedPlaylist(pl.id)} title="Delete saved playlist" data-testid={`media-delete-saved-${pl.id}`}>
                          <Trash2 className="w-3 h-3 text-muted-foreground hover:text-destructive" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* URL input */}
            {showUrlInput && (
              <div className="px-2 py-2 border-b border-border bg-muted/30 shrink-0 space-y-1.5">
                <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Load M3U Playlist or Stream</p>
                <input data-testid="media-input-url" className="w-full text-xs rounded border border-border bg-background px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring"
                  placeholder="http://... .m3u / .m3u8 / .ts / .flv" value={urlInput} onChange={e => setUrlInput(e.target.value)} onKeyDown={e => e.key === "Enter" && addUrl()} autoFocus />
                <input data-testid="media-input-url-name" className="w-full text-xs rounded border border-border bg-background px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring"
                  placeholder="Label (optional)" value={urlName} onChange={e => setUrlName(e.target.value)} onKeyDown={e => e.key === "Enter" && addUrl()} />
                <Button size="sm" className="w-full h-7 text-xs gap-1.5" onClick={addUrl} disabled={loadingM3u || !urlInput.trim()} style={{ background: "#FF8C00" }} data-testid="media-btn-add-url-confirm">
                  {loadingM3u ? <><RefreshCw className="w-3 h-3 animate-spin" />{loadProgress || "Loading…"}</> : "Load"}
                </Button>
              </div>
            )}

            {/* Search + group filter */}
            {playlist.length > 0 && (
              <div className="px-2 py-2 border-b border-border shrink-0 space-y-1.5">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
                  <Input data-testid="media-search-input" className="h-7 pl-6 pr-6 text-xs" placeholder="Search channels…"
                    value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
                  {searchQuery && (
                    <button className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" onClick={() => setSearchQuery("")} data-testid="media-search-clear">
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
                {groups.length > 0 && (
                  <div className="relative">
                    <button className="flex items-center gap-1.5 w-full text-xs px-2 py-1 rounded border border-border bg-background hover:bg-accent/50 transition-colors"
                      onClick={() => setShowGroupMenu(g => !g)} data-testid="media-group-filter">
                      <Layers className="w-3 h-3 text-muted-foreground shrink-0" />
                      <span className="flex-1 text-left truncate">{activeGroup === "__all__" ? `All groups (${groups.length})` : activeGroup}</span>
                      <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
                    </button>
                    {showGroupMenu && (
                      <div className="absolute top-full left-0 right-0 z-50 mt-0.5 bg-popover border border-border rounded-md shadow-lg overflow-hidden">
                        <div className="max-h-48 overflow-y-auto">
                          <button className={`w-full text-left text-xs px-3 py-1.5 hover:bg-accent/50 ${activeGroup === "__all__" ? "text-primary font-medium" : ""}`}
                            onClick={() => { setActiveGroup("__all__"); setShowGroupMenu(false); }} data-testid="media-group-all">
                            All channels ({playlist.length.toLocaleString()})
                          </button>
                          {groups.map(g => (
                            <button key={g} className={`w-full text-left text-xs px-3 py-1.5 hover:bg-accent/50 truncate ${activeGroup === g ? "text-primary font-medium" : ""}`}
                              onClick={() => { setActiveGroup(g); setShowGroupMenu(false); }}>
                              {g}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Channel list */}
            {playlist.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-8 text-muted-foreground px-3 flex-1">
                <ListVideo className="w-8 h-8 opacity-30" />
                <p className="text-xs text-center">Load an M3U playlist or add a stream URL</p>
                <div className="flex flex-col gap-1.5 w-full mt-1">
                  <Button size="sm" variant="outline" className="text-xs h-7 gap-1.5" data-testid="media-btn-browse-files" onClick={() => fileInputRef.current?.click()}>
                    <FolderOpen className="w-3 h-3" /> Open M3U File
                  </Button>
                  <Button size="sm" variant="outline" className="text-xs h-7 gap-1.5" data-testid="media-btn-open-url" onClick={() => setShowUrlInput(true)}>
                    <Link2 className="w-3 h-3" /> Load M3U URL
                  </Button>
                  {savedPlaylists.length > 0 && (
                    <Button size="sm" variant="outline" className="text-xs h-7 gap-1.5" onClick={() => setShowSavedPanel(true)} data-testid="media-btn-open-saved">
                      <BookOpen className="w-3 h-3" /> Load Saved ({savedPlaylists.length})
                    </Button>
                  )}
                </div>
              </div>
            ) : filteredWithIndex.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-8 text-muted-foreground flex-1">
                <Search className="w-6 h-6 opacity-30" />
                <p className="text-xs">No channels match "{searchQuery}"</p>
                <button className="text-xs text-primary hover:underline" onClick={() => { setSearchQuery(""); setActiveGroup("__all__"); }}>Clear filters</button>
              </div>
            ) : (
              <VirtualList items={filteredWithIndex} currentIndex={currentIndex} isPlaying={isPlaying} onPlay={playItem} onRemove={removeItem} />
            )}

            {/* Footer */}
            <div className="px-3 py-1.5 border-t border-border shrink-0 flex items-center justify-between">
              {loadProgress && !showUrlInput ? (
                <span className="text-xs text-orange-500 flex items-center gap-1">
                  {loadingM3u && <RefreshCw className="w-3 h-3 animate-spin" />}
                  {loadProgress}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {playlist.length.toLocaleString()} channel{playlist.length !== 1 ? "s" : ""}
                  {groups.length > 0 && ` · ${groups.length} groups`}
                </span>
              )}
              {(activeGroup !== "__all__" || searchQuery) && (
                <button className="text-[10px] text-muted-foreground hover:text-foreground" onClick={() => { setSearchQuery(""); setActiveGroup("__all__"); }}>Clear</button>
              )}
            </div>
          </div>
        )}
      </div>

      <input ref={fileInputRef} type="file" className="hidden" multiple
        accept="video/*,audio/*,.mkv,.avi,.mov,.flv,.wmv,.ts,.m2ts,.mts,.mp4,.webm,.ogg,.mp3,.wav,.flac,.aac,.opus,.m3u,.m3u8"
        onChange={e => addLocalFiles(e.target.files)} data-testid="media-file-input" />
    </div>
  );
}
