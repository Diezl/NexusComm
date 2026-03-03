import { useState, useRef, useEffect, useCallback } from "react";
import Hls from "hls.js";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Play, Pause, Volume2, VolumeX, Maximize2, Minimize2,
  SkipBack, SkipForward, X, FolderOpen, Link2,
  ListVideo, ChevronRight, Repeat, Shuffle, RefreshCw, Radio,
} from "lucide-react";

type MediaItem = {
  id: string;
  url: string;
  name: string;
  type: "local" | "url";
  streamType?: "hls" | "m3u8" | "mp4" | "webm" | "audio" | "other";
};

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
  if (lower.endsWith(".mp4") || lower.endsWith(".mov") || lower.endsWith(".mkv") || lower.endsWith(".avi")) return "mp4";
  if (lower.endsWith(".webm")) return "webm";
  if (lower.endsWith(".mp3") || lower.endsWith(".aac") || lower.endsWith(".wav") || lower.endsWith(".flac") || lower.endsWith(".ogg")) return "audio";
  return "other";
}

function isHlsStream(url: string): boolean {
  return detectStreamType(url) === "hls";
}

function isM3uFile(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith(".m3u") || lower.endsWith(".m3u8");
}

function parseM3U(content: string, baseUrl?: string): MediaItem[] {
  const lines = content.split(/\r?\n/);
  const items: MediaItem[] = [];
  let pendingName: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (line.startsWith("#EXTINF:")) {
      const match = line.match(/#EXTINF:[^,]*,(.+)/);
      pendingName = match ? match[1].trim() : null;
      continue;
    }

    if (line.startsWith("#EXT-X-STREAM-INF:")) {
      const next = lines[i + 1]?.trim();
      if (next && !next.startsWith("#")) {
        const url = resolveUrl(next, baseUrl);
        items.push({
          id: `m3u-${Date.now()}-${Math.random()}`,
          url,
          name: pendingName || extractName(next),
          type: "url",
          streamType: isHlsStream(url) ? "hls" : detectStreamType(url),
        });
        pendingName = null;
        i++;
      }
      continue;
    }

    if (line.startsWith("#")) continue;

    const url = resolveUrl(line, baseUrl);
    items.push({
      id: `m3u-${Date.now()}-${Math.random()}`,
      url,
      name: pendingName || extractName(line),
      type: "url",
      streamType: isHlsStream(url) ? "hls" : detectStreamType(url),
    });
    pendingName = null;
  }

  return items;
}

function resolveUrl(url: string, base?: string): string {
  if (!base || url.startsWith("http://") || url.startsWith("https://") || url.startsWith("//")) return url;
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
}

function extractName(url: string): string {
  try {
    const parts = url.split("/");
    const last = parts[parts.length - 1].split("?")[0];
    return last || url;
  } catch {
    return url;
  }
}

function StreamTypeBadge({ type }: { type?: MediaItem["streamType"] }) {
  if (!type || type === "other" || type === "mp4" || type === "webm") return null;
  const colors: Record<string, string> = {
    hls: "bg-orange-500/20 text-orange-400 border-orange-500/30",
    m3u8: "bg-orange-500/20 text-orange-400 border-orange-500/30",
    audio: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  };
  const labels: Record<string, string> = { hls: "HLS", m3u8: "M3U8", audio: "AUDIO" };
  return (
    <span className={`text-[9px] px-1 py-0.5 rounded border font-mono font-bold tracking-wider ${colors[type] || ""}`}>
      {labels[type] || type.toUpperCase()}
    </span>
  );
}

export function MediaPlayer() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [playlist, setPlaylist] = useState<MediaItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(-1);
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

  const currentItem = currentIndex >= 0 ? playlist[currentIndex] : null;
  const playlistRef = useRef(playlist);
  playlistRef.current = playlist;
  const currentIndexRef = useRef(currentIndex);
  currentIndexRef.current = currentIndex;
  const isLoopingRef = useRef(isLooping);
  isLoopingRef.current = isLooping;
  const isShufflingRef = useRef(isShuffling);
  isShufflingRef.current = isShuffling;

  const playItem = useCallback((index: number) => {
    const list = playlistRef.current;
    if (index < 0 || index >= list.length) return;
    setCurrentIndex(index);
    setError(null);
    setIsLive(false);
    setHlsLevels([]);
    setHlsLevel(-1);
  }, []);

  const destroyHls = useCallback(() => {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !currentItem) return;
    setCurrentTime(0);
    setDuration(0);
    destroyHls();

    if (isHlsStream(currentItem.url)) {
      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          backBufferLength: 90,
        });
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
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              hls.startLoad();
            } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
              hls.recoverMediaError();
            } else {
              setError("HLS stream error. Check the URL and try again.");
            }
          }
        });
      } else if (v.canPlayType("application/vnd.apple.mpegurl")) {
        v.src = currentItem.url;
        v.load();
        v.play().catch(() => setIsPlaying(false));
      } else {
        setError("HLS is not supported in this browser.");
      }
    } else {
      v.src = currentItem.url;
      v.load();
      v.play().catch(() => setIsPlaying(false));
    }

    return () => { destroyHls(); };
  }, [currentItem?.url, destroyHls]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTimeUpdate = () => setCurrentTime(v.currentTime);
    const onDuration = () => {
      setDuration(v.duration);
      setIsLive(!isFinite(v.duration));
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onEnded = () => {
      if (isLoopingRef.current) { v.play(); return; }
      const list = playlistRef.current;
      const idx = currentIndexRef.current;
      const next = isShufflingRef.current
        ? Math.floor(Math.random() * list.length)
        : idx + 1;
      if (next < list.length) playItem(next);
      else setIsPlaying(false);
    };
    const onWaiting = () => setIsBuffering(true);
    const onCanPlay = () => setIsBuffering(false);
    const onError = () => {
      if (!hlsRef.current) setError("Cannot play this file. Format may not be supported.");
    };
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
    v.currentTime = val[0];
    setCurrentTime(val[0]);
  };

  const changeVolume = (val: number[]) => {
    const v = videoRef.current;
    const vol = val[0];
    setVolume(vol);
    setIsMuted(vol === 0);
    if (v) { v.volume = vol; v.muted = vol === 0; }
  };

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    const next = !isMuted;
    setIsMuted(next);
    v.muted = next;
  };

  const skipRelative = (sec: number) => {
    const v = videoRef.current;
    if (!v || isLive) return;
    v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + sec));
  };

  const toggleFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  };

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const processM3uContent = useCallback((content: string, baseUrl?: string, listName?: string) => {
    const items = parseM3U(content, baseUrl);
    if (items.length === 0) return false;
    const wasEmpty = playlistRef.current.length === 0 && currentIndexRef.current < 0;
    const startIdx = playlistRef.current.length;
    setPlaylist(prev => [...prev, ...items]);
    if (wasEmpty) setCurrentIndex(startIdx);
    return true;
  }, []);

  const addLocalFiles = async (files: FileList | null) => {
    if (!files) return;
    const regular: MediaItem[] = [];

    for (const f of Array.from(files)) {
      if (isM3uFile(f.name)) {
        setLoadingM3u(true);
        try {
          const text = await f.text();
          const blobUrl = URL.createObjectURL(f);
          const ok = processM3uContent(text, blobUrl, f.name);
          if (!ok) setError(`No valid entries found in ${f.name}`);
        } catch {
          setError(`Failed to read ${f.name}`);
        } finally {
          setLoadingM3u(false);
        }
      } else {
        regular.push({
          id: `${Date.now()}-${Math.random()}`,
          url: URL.createObjectURL(f),
          name: f.name,
          type: "local",
          streamType: detectStreamType(f.name),
        });
      }
    }

    if (regular.length > 0) {
      const wasEmpty = playlist.length === 0 && currentIndex < 0;
      const startIdx = playlist.length;
      setPlaylist(prev => [...prev, ...regular]);
      if (wasEmpty) setCurrentIndex(startIdx);
    }
  };

  const addUrl = async () => {
    if (!urlInput.trim()) return;
    const rawUrl = urlInput.trim();
    const lower = rawUrl.toLowerCase().split("?")[0];

    if (lower.endsWith(".m3u") || lower.endsWith(".m3u8")) {
      setLoadingM3u(true);
      try {
        const res = await fetch(rawUrl);
        if (!res.ok) throw new Error("Failed to fetch");
        const text = await res.text();
        const ok = processM3uContent(text, rawUrl, urlName.trim() || extractName(rawUrl));
        if (!ok) {
          const item: MediaItem = {
            id: `${Date.now()}`,
            url: rawUrl,
            name: urlName.trim() || extractName(rawUrl),
            type: "url",
            streamType: "hls",
          };
          const wasEmpty = playlist.length === 0 && currentIndex < 0;
          const startIdx = playlist.length;
          setPlaylist(prev => [...prev, item]);
          if (wasEmpty) setCurrentIndex(startIdx);
        }
      } catch {
        const item: MediaItem = {
          id: `${Date.now()}`,
          url: rawUrl,
          name: urlName.trim() || extractName(rawUrl),
          type: "url",
          streamType: isHlsStream(rawUrl) ? "hls" : detectStreamType(rawUrl),
        };
        const wasEmpty = playlist.length === 0 && currentIndex < 0;
        const startIdx = playlist.length;
        setPlaylist(prev => [...prev, item]);
        if (wasEmpty) setCurrentIndex(startIdx);
      } finally {
        setLoadingM3u(false);
      }
    } else {
      const item: MediaItem = {
        id: `${Date.now()}`,
        url: rawUrl,
        name: urlName.trim() || extractName(rawUrl),
        type: "url",
        streamType: isHlsStream(rawUrl) ? "hls" : detectStreamType(rawUrl),
      };
      const wasEmpty = playlist.length === 0 && currentIndex < 0;
      const startIdx = playlist.length;
      setPlaylist(prev => [...prev, item]);
      if (wasEmpty) setCurrentIndex(startIdx);
    }

    setUrlInput("");
    setUrlName("");
    setShowUrlInput(false);
  };

  const removeItem = (id: string, idx: number) => {
    setPlaylist(prev => prev.filter(p => p.id !== id));
    if (idx === currentIndex) {
      destroyHls();
      setCurrentIndex(-1);
      if (videoRef.current) { videoRef.current.src = ""; }
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(0);
      setIsLive(false);
    } else if (idx < currentIndex) {
      setCurrentIndex(i => i - 1);
    }
  };

  const switchQuality = (level: number) => {
    if (hlsRef.current) {
      hlsRef.current.currentLevel = level;
    }
  };

  return (
    <div className="flex flex-col h-full bg-background" ref={containerRef}>
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
        <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0" style={{ background: "linear-gradient(135deg, #FF8C00, #FF4500)" }}>
          <div className="w-2.5 h-2.5 rounded-full bg-white/90" />
        </div>
        <h2 className="font-semibold text-sm">Media Player</h2>
        <div className="flex gap-1 ml-2">
          <Badge variant="secondary" className="text-xs">VLC-style</Badge>
          <Badge variant="outline" className="text-xs text-orange-500 border-orange-500/40">HLS</Badge>
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
        {/* Video + controls column */}
        <div className="flex flex-col flex-1 min-w-0">
          {/* Video area */}
          <div className="relative flex-1 bg-black flex items-center justify-center min-h-0 overflow-hidden">
            <video
              ref={videoRef}
              className="max-w-full max-h-full object-contain"
              style={{ width: "100%", height: "100%" }}
              onClick={togglePlay}
              data-testid="media-player-video"
            />
            {!currentItem && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/50 pointer-events-none select-none">
                <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ background: "rgba(255,140,0,0.15)" }}>
                  <Play className="w-8 h-8" style={{ color: "#FF8C00" }} />
                </div>
                <p className="text-sm">Add media, HLS stream, or M3U playlist</p>
                <div className="flex gap-2 text-xs">
                  <span className="px-2 py-0.5 rounded bg-white/10">mp4 / webm</span>
                  <span className="px-2 py-0.5 rounded bg-orange-500/20 text-orange-400">.m3u8 HLS</span>
                  <span className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-400">.m3u playlist</span>
                </div>
              </div>
            )}
            {(isBuffering && currentItem) && (
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
                  <button
                    key={i}
                    onClick={() => switchQuality(i)}
                    className={`text-xs px-2 py-0.5 rounded font-mono ${hlsLevel === i ? "bg-orange-500 text-white" : "bg-black/60 text-white/70 hover:bg-black/80"}`}
                    data-testid={`media-quality-${i}`}
                    title={`${l.height}p — ${Math.round(l.bitrate / 1000)}kbps`}
                  >
                    {l.height > 0 ? `${l.height}p` : `Q${i}`}
                  </button>
                ))}
                <button
                  onClick={() => switchQuality(-1)}
                  className={`text-xs px-2 py-0.5 rounded font-mono ${hlsLevel === -1 ? "bg-orange-500 text-white" : "bg-black/60 text-white/70 hover:bg-black/80"}`}
                  data-testid="media-quality-auto"
                >
                  Auto
                </button>
              </div>
            )}
          </div>

          {/* Now playing */}
          {currentItem && (
            <div className="px-4 py-1.5 text-xs border-t border-border shrink-0 flex items-center gap-2">
              {isLive && <Radio className="w-3 h-3 text-red-500 animate-pulse shrink-0" />}
              <span className="font-medium text-foreground truncate">{currentItem.name}</span>
              <StreamTypeBadge type={currentItem.streamType} />
            </div>
          )}

          {/* Progress */}
          <div className="px-3 pt-2 pb-0 shrink-0">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <span data-testid="media-current-time">{isLive ? "LIVE" : formatTime(currentTime)}</span>
              <div className="flex-1">
                {isLive ? (
                  <div className="h-1 rounded-full bg-red-500/30 relative overflow-hidden">
                    <div className="absolute inset-0 bg-red-500/60 animate-pulse" />
                  </div>
                ) : (
                  <Slider
                    data-testid="media-progress-slider"
                    min={0}
                    max={duration || 1}
                    step={0.5}
                    value={[currentTime]}
                    onValueChange={seek}
                    className="h-1"
                  />
                )}
              </div>
              <span data-testid="media-duration">{isLive ? "∞" : formatTime(duration)}</span>
            </div>
          </div>

          {/* Transport controls */}
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
              <Button size="icon" variant="ghost" className="w-8 h-8" data-testid="media-btn-prev" onClick={() => playItem(Math.max(0, currentIndex - 1))} disabled={!currentItem} title="Previous">
                <SkipBack className="w-4 h-4" />
              </Button>
              <Button size="icon" variant="ghost" className="w-8 h-8" data-testid="media-btn-rewind" onClick={() => skipRelative(-10)} disabled={!currentItem || isLive} title="Rewind 10s">
                <SkipBack className="w-3.5 h-3.5 text-muted-foreground" />
              </Button>
              <Button
                size="icon"
                variant="default"
                className="w-9 h-9 rounded-full"
                data-testid="media-btn-playpause"
                onClick={togglePlay}
                disabled={!currentItem}
                style={{ background: currentItem ? "#FF8C00" : undefined, color: "white" }}
                title={isPlaying ? "Pause" : "Play"}
              >
                {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              </Button>
              <Button size="icon" variant="ghost" className="w-8 h-8" data-testid="media-btn-forward" onClick={() => skipRelative(10)} disabled={!currentItem || isLive} title="Forward 10s">
                <SkipForward className="w-3.5 h-3.5 text-muted-foreground" />
              </Button>
              <Button size="icon" variant="ghost" className="w-8 h-8" data-testid="media-btn-next" onClick={() => playItem(Math.min(playlist.length - 1, currentIndex + 1))} disabled={!currentItem} title="Next">
                <SkipForward className="w-4 h-4" />
              </Button>
            </div>

            <div className="flex items-center gap-1.5">
              <Button size="icon" variant="ghost" className="w-7 h-7" data-testid="media-btn-mute" onClick={toggleMute} title={isMuted ? "Unmute" : "Mute"}>
                {isMuted || volume === 0 ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
              </Button>
              <div className="w-16">
                <Slider data-testid="media-volume-slider" min={0} max={1} step={0.05} value={[isMuted ? 0 : volume]} onValueChange={changeVolume} className="h-1" />
              </div>
              <Button size="icon" variant="ghost" className="w-7 h-7" data-testid="media-btn-fullscreen" onClick={toggleFullscreen} title="Fullscreen">
                {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
              </Button>
              <Button size="icon" variant="ghost" className="w-7 h-7" data-testid="media-btn-playlist-toggle" onClick={() => setShowPlaylist(p => !p)} title="Playlist">
                <ListVideo className={`w-3.5 h-3.5 ${showPlaylist ? "text-primary" : ""}`} />
              </Button>
            </div>
          </div>
        </div>

        {/* Playlist panel */}
        {showPlaylist && (
          <div className="w-60 border-l border-border flex flex-col shrink-0">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Playlist</span>
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" className="w-6 h-6" data-testid="media-btn-add-file" onClick={() => fileInputRef.current?.click()} title="Add file / M3U">
                  <FolderOpen className="w-3 h-3" />
                </Button>
                <Button size="icon" variant="ghost" className="w-6 h-6" data-testid="media-btn-add-url" onClick={() => setShowUrlInput(u => !u)} title="Add URL / HLS stream">
                  <Link2 className="w-3 h-3" />
                </Button>
                <Button size="icon" variant="ghost" className="w-6 h-6" data-testid="media-btn-clear-playlist" onClick={() => { destroyHls(); setPlaylist([]); setCurrentIndex(-1); if (videoRef.current) videoRef.current.src = ""; setIsPlaying(false); setIsLive(false); }} title="Clear">
                  <X className="w-3 h-3" />
                </Button>
              </div>
            </div>

            {/* URL input */}
            {showUrlInput && (
              <div className="px-2 py-2 border-b border-border bg-muted/30 shrink-0 space-y-1.5">
                <input
                  data-testid="media-input-url"
                  className="w-full text-xs rounded border border-border bg-background px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
                  placeholder="URL, .m3u8 HLS, or .m3u playlist…"
                  value={urlInput}
                  onChange={e => setUrlInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && addUrl()}
                />
                <input
                  data-testid="media-input-url-name"
                  className="w-full text-xs rounded border border-border bg-background px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring"
                  placeholder="Label (optional)"
                  value={urlName}
                  onChange={e => setUrlName(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && addUrl()}
                />
                <Button
                  size="sm"
                  className="w-full h-6 text-xs"
                  onClick={addUrl}
                  disabled={loadingM3u}
                  style={{ background: "#FF8C00" }}
                  data-testid="media-btn-add-url-confirm"
                >
                  {loadingM3u ? <RefreshCw className="w-3 h-3 mr-1 animate-spin" /> : null}
                  {loadingM3u ? "Loading…" : "Add"}
                </Button>
                <p className="text-[10px] text-muted-foreground leading-tight">
                  Supports .m3u8 HLS streams and .m3u playlists. M3U files are parsed and each channel/entry is added individually.
                </p>
              </div>
            )}

            <ScrollArea className="flex-1">
              {playlist.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-8 text-muted-foreground px-3">
                  <ListVideo className="w-8 h-8 opacity-30" />
                  <p className="text-xs text-center">Add files, URLs, HLS streams, or M3U playlists</p>
                  <div className="flex flex-col gap-1 w-full mt-1">
                    <Button size="sm" variant="outline" className="text-xs h-7" data-testid="media-btn-browse-files" onClick={() => fileInputRef.current?.click()}>
                      <FolderOpen className="w-3 h-3 mr-1" /> Browse / Open M3U
                    </Button>
                    <Button size="sm" variant="outline" className="text-xs h-7" data-testid="media-btn-open-url" onClick={() => setShowUrlInput(true)}>
                      <Link2 className="w-3 h-3 mr-1" /> Add HLS / URL
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="py-1">
                  {playlist.map((item, idx) => (
                    <div
                      key={item.id}
                      className={`flex items-center gap-1.5 px-2 py-1.5 cursor-pointer group hover:bg-accent/50 ${idx === currentIndex ? "bg-accent" : ""}`}
                      onClick={() => playItem(idx)}
                      data-testid={`media-playlist-item-${idx}`}
                    >
                      {idx === currentIndex ? (
                        <div className="w-3 h-3 shrink-0 flex items-center justify-center">
                          {isPlaying
                            ? <span className="flex gap-0.5">{[0, 1, 2].map(i => <span key={i} className="w-0.5 h-3 bg-primary rounded animate-pulse" style={{ animationDelay: `${i * 0.15}s` }} />)}</span>
                            : <ChevronRight className="w-3 h-3 text-primary" />}
                        </div>
                      ) : (
                        <div className="w-3 h-3 shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs truncate ${idx === currentIndex ? "text-primary font-medium" : ""}`} title={item.name}>
                          {item.name}
                        </p>
                        <StreamTypeBadge type={item.streamType} />
                      </div>
                      <button
                        className="opacity-0 group-hover:opacity-100 shrink-0 ml-1"
                        onClick={e => { e.stopPropagation(); removeItem(item.id, idx); }}
                        data-testid={`media-remove-item-${idx}`}
                        title="Remove"
                      >
                        <X className="w-3 h-3 text-muted-foreground hover:text-destructive" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>

            <div className="px-3 py-2 border-t border-border shrink-0 flex items-center justify-between">
              <p className="text-xs text-muted-foreground">{playlist.length} item{playlist.length !== 1 ? "s" : ""}</p>
              {loadingM3u && <span className="text-xs text-orange-500 flex items-center gap-1"><RefreshCw className="w-3 h-3 animate-spin" />Parsing…</span>}
            </div>
          </div>
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        multiple
        accept="video/*,audio/*,.mkv,.avi,.mov,.flv,.wmv,.mp4,.webm,.ogg,.mp3,.wav,.flac,.aac,.m3u,.m3u8"
        onChange={e => addLocalFiles(e.target.files)}
        data-testid="media-file-input"
      />
    </div>
  );
}
