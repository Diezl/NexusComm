import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  Send, Paperclip, Phone, Video, Hash, User,
  File, Image, Download, FolderOpen, Upload,
  RefreshCw, ExternalLink, Cloud, ChevronLeft, ChevronRight,
} from "lucide-react";
import { SiDropbox, SiGoogledocs, SiGooglesheets, SiGoogleslides, SiGoogledrive } from "react-icons/si";
import type { MessageWithUser, UserPublic, ChannelWithMeta } from "@shared/schema";
import { format, isToday, isYesterday } from "date-fns";
import { useToast } from "@/hooks/use-toast";

type GoogleDocInfo = {
  type: "doc" | "sheet" | "slide" | "drive" | "unknown";
  id: string;
  url: string;
  title: string;
};

function parseGoogleDocUrl(url: string): GoogleDocInfo | null {
  try {
    const u = new URL(url.trim());
    if (!u.hostname.includes("google.com")) return null;

    let type: GoogleDocInfo["type"] = "unknown";
    let id = "";
    let title = "";

    if (u.hostname === "docs.google.com") {
      const parts = u.pathname.split("/");
      const dIdx = parts.indexOf("d");
      if (dIdx >= 0) id = parts[dIdx + 1] || "";
      if (u.pathname.includes("/document/")) { type = "doc"; title = "Google Doc"; }
      else if (u.pathname.includes("/spreadsheets/")) { type = "sheet"; title = "Google Sheet"; }
      else if (u.pathname.includes("/presentation/")) { type = "slide"; title = "Google Slides"; }
      else { type = "unknown"; title = "Google File"; }
    } else if (u.hostname === "drive.google.com") {
      type = "drive";
      title = "Google Drive File";
      const parts = u.pathname.split("/");
      const dIdx = parts.indexOf("d");
      if (dIdx >= 0) id = parts[dIdx + 1] || "";
      else id = u.searchParams.get("id") || "";
    } else {
      return null;
    }
    return { type, id, url: url.trim(), title };
  } catch {
    return null;
  }
}

function isGoogleDocUrl(url: string) {
  return url?.includes("docs.google.com") || url?.includes("drive.google.com");
}

function GoogleDocCard({ url, fileName }: { url: string; fileName?: string | null }) {
  const info = parseGoogleDocUrl(url);
  const label = fileName || info?.title || "Google Doc";
  const Icon = info?.type === "sheet" ? SiGooglesheets
    : info?.type === "slide" ? SiGoogleslides
    : info?.type === "drive" ? SiGoogledrive
    : SiGoogledocs;
  const iconColor = info?.type === "sheet" ? "#34A853"
    : info?.type === "slide" ? "#FBBC04"
    : info?.type === "drive" ? "#4285F4"
    : "#4285F4";
  const typeLabel = info?.type === "sheet" ? "Google Sheets"
    : info?.type === "slide" ? "Google Slides"
    : info?.type === "drive" ? "Google Drive"
    : "Google Docs";

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card hover:bg-accent/30 transition-colors max-w-sm group"
    >
      <div className="w-10 h-10 rounded-md flex items-center justify-center shrink-0" style={{ backgroundColor: `${iconColor}18` }}>
        <Icon style={{ color: iconColor }} className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{label}</p>
        <p className="text-xs text-muted-foreground">{typeLabel}</p>
      </div>
      <ExternalLink className="w-3.5 h-3.5 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
    </a>
  );
}

type DropboxFile = {
  name: string;
  path: string;
  type: "file" | "folder";
  size: number;
  modified: string | null;
  id: string;
};

type Props = {
  type: "channel" | "dm";
  channel?: ChannelWithMeta;
  dmUser?: UserPublic;
  currentUser: UserPublic;
  messages: MessageWithUser[];
  onMessage: (data: object) => void;
  onLocalMessage?: (msg: MessageWithUser) => void;
  onStartCall: (type: "audio" | "video", userId: string) => void;
  typingUsers?: Set<string>;
  allUsers: UserPublic[];
};

function getInitials(name: string) {
  return name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
}

function formatTime(date: Date | string | null) {
  if (!date) return "";
  const d = new Date(date);
  if (isToday(d)) return format(d, "h:mm a");
  if (isYesterday(d)) return `Yesterday ${format(d, "h:mm a")}`;
  return format(d, "MMM d, h:mm a");
}

function formatBytes(bytes: number) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function groupMessages(messages: MessageWithUser[]) {
  const groups: { date: string; messages: MessageWithUser[] }[] = [];
  messages.forEach(msg => {
    const date = msg.createdAt ? format(new Date(msg.createdAt), "MMMM d, yyyy") : "Unknown";
    const last = groups[groups.length - 1];
    if (!last || last.date !== date) {
      groups.push({ date, messages: [msg] });
    } else {
      last.messages.push(msg);
    }
  });
  return groups;
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    online: "bg-status-online",
    away: "bg-status-away",
    busy: "bg-status-busy",
    offline: "bg-status-offline",
  };
  return (
    <span className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-card ${colors[status] || colors.offline}`} />
  );
}

function isDropboxUrl(url: string) {
  return url?.includes("dropbox.com") || url?.includes("dl.dropbox");
}

export function ChatWindow({ type, channel, dmUser, currentUser, messages, onMessage, onLocalMessage, onStartCall, typingUsers = new Set(), allUsers }: Props) {
  const { toast } = useToast();
  const [content, setContent] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [isDropboxPickerOpen, setIsDropboxPickerOpen] = useState(false);
  const [isLoadingDropboxFiles, setIsLoadingDropboxFiles] = useState(false);
  const [dropboxFiles, setDropboxFiles] = useState<DropboxFile[]>([]);
  const [currentDropboxFolder, setCurrentDropboxFolder] = useState('');
  const [folderHistory, setFolderHistory] = useState<string[]>([]);
  const [isGoogleDocDialogOpen, setIsGoogleDocDialogOpen] = useState(false);
  const [googleDocUrl, setGoogleDocUrl] = useState("");
  const [googleDocLabel, setGoogleDocLabel] = useState("");
  const [typingTimeout, setTypingTimeout] = useState<NodeJS.Timeout | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropboxInputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendTyping = useCallback((isTyping: boolean) => {
    onMessage({
      type: "typing",
      channelId: type === "channel" ? channel?.id : undefined,
      toUserId: type === "dm" ? dmUser?.id : undefined,
      isTyping,
    });
  }, [type, channel?.id, dmUser?.id, onMessage]);

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value);
    if (typingTimeout) clearTimeout(typingTimeout);
    sendTyping(true);
    const t = setTimeout(() => sendTyping(false), 2000);
    setTypingTimeout(t);
  };

  const sendMessage = useCallback(() => {
    if (!content.trim()) return;
    onMessage({
      type: "message",
      content: content.trim(),
      channelId: type === "channel" ? channel?.id : undefined,
      toUserId: type === "dm" ? dmUser?.id : undefined,
    });
    setContent("");
    sendTyping(false);
    if (typingTimeout) clearTimeout(typingTimeout);
  }, [content, type, channel?.id, dmUser?.id, onMessage, sendTyping, typingTimeout]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleLocalUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      const data = await res.json();
      const isImage = file.type.startsWith("image/");
      onMessage({
        type: "message",
        content: "",
        channelId: type === "channel" ? channel?.id : undefined,
        toUserId: type === "dm" ? dmUser?.id : undefined,
        messageType: isImage ? "image" : "file",
        fileName: data.fileName,
        fileUrl: data.fileUrl,
        fileSize: data.fileSize,
        mimeType: data.mimeType,
      });
    } catch {
      toast({ title: "Upload failed", variant: "destructive" });
    }
    setIsUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDropboxUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    toast({ title: "Uploading to Dropbox...", description: file.name });
    try {
      const formData = new FormData();
      formData.append("file", file);
      if (currentDropboxFolder) formData.append("folder", currentDropboxFolder);
      const res = await fetch("/api/dropbox/upload", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();
      const isImage = file.type.startsWith("image/");
      onMessage({
        type: "message",
        content: "",
        channelId: type === "channel" ? channel?.id : undefined,
        toUserId: type === "dm" ? dmUser?.id : undefined,
        messageType: isImage ? "image" : "file",
        fileName: data.fileName,
        fileUrl: data.fileUrl,
        fileSize: data.fileSize,
        mimeType: data.mimeType,
      });
      toast({ title: "Uploaded to Dropbox", description: data.fileName });
    } catch {
      toast({ title: "Dropbox upload failed", variant: "destructive" });
    }
    setIsUploading(false);
    if (dropboxInputRef.current) dropboxInputRef.current.value = "";
  };

  const loadDropboxFiles = async (folder = currentDropboxFolder) => {
    setIsLoadingDropboxFiles(true);
    try {
      const params = folder ? `?folder=${encodeURIComponent(folder)}` : '';
      const res = await fetch(`/api/dropbox/files${params}`, { credentials: "include" });
      if (!res.ok) throw new Error();
      const files = await res.json();
      setDropboxFiles(files);
    } catch {
      toast({ title: "Could not load Dropbox files", variant: "destructive" });
    }
    setIsLoadingDropboxFiles(false);
  };

  const openDropboxPicker = async () => {
    setCurrentDropboxFolder('');
    setFolderHistory([]);
    setIsDropboxPickerOpen(true);
    setIsLoadingDropboxFiles(true);
    try {
      const res = await fetch('/api/dropbox/files', { credentials: "include" });
      if (!res.ok) throw new Error();
      const files = await res.json();
      setDropboxFiles(files);
    } catch {
      toast({ title: "Could not load Dropbox files", variant: "destructive" });
    }
    setIsLoadingDropboxFiles(false);
  };

  const navigateToFolder = async (folderPath: string) => {
    setFolderHistory(h => [...h, currentDropboxFolder]);
    setCurrentDropboxFolder(folderPath);
    await loadDropboxFiles(folderPath);
  };

  const navigateBack = async () => {
    const prev = folderHistory[folderHistory.length - 1] ?? '';
    setFolderHistory(h => h.slice(0, -1));
    setCurrentDropboxFolder(prev);
    await loadDropboxFiles(prev);
  };

  const shareGoogleDoc = async () => {
    const info = parseGoogleDocUrl(googleDocUrl);
    if (!info) {
      toast({ title: "Invalid Google link", description: "Please paste a valid Google Docs, Sheets, Slides, or Drive URL.", variant: "destructive" });
      return;
    }
    try {
      const res = await fetch("/api/messages/share-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          channelId: type === "channel" ? channel?.id : undefined,
          toUserId: type === "dm" ? dmUser?.id : undefined,
          fileName: googleDocLabel.trim() || info.title,
          fileUrl: info.url,
          mimeType: `application/google-${info.type}`,
        }),
      });
      if (!res.ok) throw new Error("Failed to share");
      const enriched = await res.json();
      onLocalMessage?.(enriched);
      setIsGoogleDocDialogOpen(false);
      setGoogleDocUrl("");
      setGoogleDocLabel("");
      toast({ title: "Google Doc shared" });
    } catch {
      toast({ title: "Failed to share Google Doc", variant: "destructive" });
    }
  };

  const shareDropboxFile = async (file: DropboxFile) => {
    try {
      const res = await fetch("/api/dropbox/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ path: file.path }),
      });
      const data = await res.json();
      if (!data.url) throw new Error();
      onMessage({
        type: "message",
        content: "",
        channelId: type === "channel" ? channel?.id : undefined,
        toUserId: type === "dm" ? dmUser?.id : undefined,
        messageType: "file",
        fileName: file.name,
        fileUrl: data.url,
        fileSize: file.size,
        mimeType: "",
      });
      setIsDropboxPickerOpen(false);
      toast({ title: "Dropbox file shared", description: file.name });
    } catch {
      toast({ title: "Could not share file", variant: "destructive" });
    }
  };

  const getUserById = (id: string) => allUsers.find(u => u.id === id);
  const typingNames = [...typingUsers]
    .map(id => getUserById(id)?.displayName?.split(" ")[0])
    .filter(Boolean);

  const title = type === "channel" ? `#${channel?.name}` : dmUser?.displayName;
  const subtitle = type === "channel"
    ? `${channel?.memberCount || 0} members`
    : dmUser?.department || dmUser?.role;

  const messageGroups = groupMessages(messages);

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-3">
          {type === "channel" ? (
            <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center">
              <Hash className="w-4 h-4 text-primary" />
            </div>
          ) : (
            <div className="relative">
              <Avatar className="w-8 h-8">
                <AvatarFallback className="text-xs bg-primary/10 text-primary">
                  {getInitials(dmUser?.displayName || "?")}
                </AvatarFallback>
              </Avatar>
              <StatusDot status={dmUser?.status || "offline"} />
            </div>
          )}
          <div>
            <h2 className="font-semibold text-sm text-foreground" data-testid="chat-title">{title}</h2>
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {type === "dm" && dmUser && (
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon" variant="ghost" data-testid="button-start-audio-call" onClick={() => onStartCall("audio", dmUser.id)}>
                    <Phone className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Voice Call</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="icon" variant="ghost" data-testid="button-start-video-call" onClick={() => onStartCall("video", dmUser.id)}>
                    <Video className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Video Call</TooltipContent>
              </Tooltip>
            </>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                data-testid="button-open-dropbox-header"
                onClick={openDropboxPicker}
              >
                <SiDropbox className="w-4 h-4 text-[#0061FF]" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Browse Dropbox files</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 px-4">
        <div className="py-4 space-y-6">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              {type === "channel" ? (
                <>
                  <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                    <Hash className="w-8 h-8 text-primary" />
                  </div>
                  <h3 className="font-semibold text-lg">Welcome to #{channel?.name}</h3>
                  <p className="text-muted-foreground text-sm mt-1">{channel?.description || "Start the conversation"}</p>
                </>
              ) : (
                <>
                  <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                    <User className="w-8 h-8 text-primary" />
                  </div>
                  <h3 className="font-semibold text-lg">Start a conversation</h3>
                  <p className="text-muted-foreground text-sm mt-1">This is the beginning of your direct message history with {dmUser?.displayName}</p>
                </>
              )}
            </div>
          )}

          {messageGroups.map(group => (
            <div key={group.date}>
              <div className="flex items-center gap-3 my-4">
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-muted-foreground shrink-0">{group.date}</span>
                <div className="flex-1 h-px bg-border" />
              </div>
              <div className="space-y-1">
                {group.messages.map((msg, idx) => {
                  const prevMsg = idx > 0 ? group.messages[idx - 1] : null;
                  const isGrouped = prevMsg && prevMsg.fromUserId === msg.fromUserId
                    && msg.createdAt && prevMsg.createdAt
                    && new Date(msg.createdAt).getTime() - new Date(prevMsg.createdAt).getTime() < 5 * 60 * 1000;
                  const fromDropbox = msg.fileUrl ? isDropboxUrl(msg.fileUrl) : false;
                  const fromGoogle = msg.fileUrl ? isGoogleDocUrl(msg.fileUrl) : false;

                  return (
                    <div key={msg.id} data-testid={`message-${msg.id}`} className={`flex gap-3 group ${isGrouped ? "mt-0.5" : "mt-3"}`}>
                      <div className="w-8 shrink-0">
                        {!isGrouped && (
                          <Avatar className="w-8 h-8">
                            <AvatarFallback className="text-xs bg-primary/10 text-primary">
                              {getInitials(msg.user.displayName)}
                            </AvatarFallback>
                          </Avatar>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        {!isGrouped && (
                          <div className="flex items-baseline gap-2 mb-0.5">
                            <span className="font-semibold text-sm text-foreground">{msg.user.displayName}</span>
                            <span className="text-xs text-muted-foreground">{formatTime(msg.createdAt)}</span>
                          </div>
                        )}
                        {msg.type === "text" && (
                          <p className="text-sm text-foreground break-words leading-relaxed">{msg.content}</p>
                        )}
                        {msg.type === "image" && (
                          <div className="mt-1">
                            <img
                              src={msg.fileUrl || ""}
                              alt={msg.fileName || "Image"}
                              className="max-w-xs max-h-64 rounded-md object-cover border border-border"
                            />
                            {fromDropbox && (
                              <div className="flex items-center gap-1 mt-1">
                                <SiDropbox className="w-3 h-3 text-[#0061FF]" />
                                <span className="text-xs text-muted-foreground">Dropbox</span>
                              </div>
                            )}
                          </div>
                        )}
                        {msg.type === "file" && fromGoogle && (
                          <div className="mt-1">
                            <GoogleDocCard url={msg.fileUrl || ""} fileName={msg.fileName} />
                          </div>
                        )}
                        {msg.type === "file" && !fromGoogle && (
                          <div className="mt-1 flex items-center gap-3 p-3 bg-card border border-card-border rounded-md w-fit max-w-xs">
                            <div className="w-8 h-8 flex items-center justify-center shrink-0">
                              {fromDropbox
                                ? <SiDropbox className="w-7 h-7 text-[#0061FF]" />
                                : <File className="w-8 h-8 text-primary" />}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium truncate">{msg.fileName}</p>
                              <div className="flex items-center gap-2">
                                {fromDropbox && (
                                  <span className="text-xs text-[#0061FF] font-medium">Dropbox</span>
                                )}
                                {msg.fileSize ? (
                                  <span className="text-xs text-muted-foreground">{formatBytes(msg.fileSize)}</span>
                                ) : null}
                              </div>
                            </div>
                            <a href={msg.fileUrl || ""} target="_blank" rel="noopener noreferrer" className="ml-auto shrink-0">
                              <Button size="icon" variant="ghost">
                                {fromDropbox ? <ExternalLink className="w-4 h-4" /> : <Download className="w-4 h-4" />}
                              </Button>
                            </a>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {typingNames.length > 0 && (
            <div className="flex items-center gap-2 px-1 pb-2">
              <div className="flex gap-0.5">
                {[0, 1, 2].map(i => (
                  <div key={i} className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                ))}
              </div>
              <span className="text-xs text-muted-foreground">
                {typingNames.join(", ")} {typingNames.length === 1 ? "is" : "are"} typing...
              </span>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Input area */}
      <div className="px-4 pb-4 pt-2 shrink-0">
        <div className="flex items-end gap-2 bg-card border border-card-border rounded-md px-3 py-2">
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    data-testid="button-attach-menu"
                    disabled={isUploading}
                    className="shrink-0 mb-0.5"
                  >
                    <Paperclip className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>Attach file</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="start" side="top">
              <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">Upload from</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => fileInputRef.current?.click()} data-testid="menu-upload-local">
                <Upload className="w-4 h-4 mr-2 text-muted-foreground" />
                Your device
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => dropboxInputRef.current?.click()} data-testid="menu-upload-dropbox">
                <SiDropbox className="w-4 h-4 mr-2 text-[#0061FF]" />
                Upload to Dropbox
              </DropdownMenuItem>
              <DropdownMenuItem onClick={openDropboxPicker} data-testid="menu-browse-dropbox">
                <FolderOpen className="w-4 h-4 mr-2 text-[#0061FF]" />
                Browse Dropbox files
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setIsGoogleDocDialogOpen(true)} data-testid="menu-share-google-doc">
                <SiGoogledocs className="w-4 h-4 mr-2 text-[#4285F4]" />
                Share Google Doc
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <input ref={fileInputRef} type="file" className="hidden" onChange={handleLocalUpload} accept="*/*" />
          <input ref={dropboxInputRef} type="file" className="hidden" onChange={handleDropboxUpload} accept="*/*" />

          <Textarea
            data-testid="input-message"
            placeholder={type === "channel" ? `Message #${channel?.name}` : `Message ${dmUser?.displayName}`}
            value={content}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            className="flex-1 resize-none border-0 bg-transparent focus-visible:ring-0 text-sm min-h-[36px] max-h-32 py-1.5"
            rows={1}
          />
          <Button
            size="icon"
            data-testid="button-send-message"
            onClick={sendMessage}
            disabled={!content.trim() || isUploading}
            className="shrink-0 mb-0.5"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-1.5 px-1">Enter to send · Shift+Enter for new line</p>
      </div>

      {/* Dropbox File Picker Dialog */}
      <Dialog open={isDropboxPickerOpen} onOpenChange={setIsDropboxPickerOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <SiDropbox className="w-5 h-5 text-[#0061FF]" />
              Dropbox
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {/* Breadcrumb + controls row */}
            <div className="flex items-center gap-2">
              {folderHistory.length > 0 && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 shrink-0"
                  onClick={navigateBack}
                  disabled={isLoadingDropboxFiles}
                  data-testid="button-dropbox-back"
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
              )}
              <div className="flex-1 flex items-center gap-1 text-sm text-muted-foreground min-w-0 overflow-hidden">
                <button
                  className="hover:text-foreground shrink-0"
                  onClick={() => { setFolderHistory([]); setCurrentDropboxFolder(''); loadDropboxFiles(''); }}
                  data-testid="breadcrumb-root"
                >
                  Home
                </button>
                {currentDropboxFolder.split('/').filter(Boolean).map((segment, i, arr) => {
                  const path = '/' + arr.slice(0, i + 1).join('/');
                  return (
                    <span key={path} className="flex items-center gap-1 shrink-0">
                      <ChevronRight className="w-3 h-3" />
                      <button
                        className="hover:text-foreground truncate max-w-[120px]"
                        onClick={() => { setFolderHistory(h => h.slice(0, i + 1)); setCurrentDropboxFolder(path); loadDropboxFiles(path); }}
                        data-testid={`breadcrumb-${segment}`}
                      >
                        {segment}
                      </button>
                    </span>
                  );
                })}
              </div>
              <p className="text-xs text-muted-foreground shrink-0">
                {isLoadingDropboxFiles ? "Loading..." : `${dropboxFiles.length} item${dropboxFiles.length !== 1 ? "s" : ""}`}
              </p>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => loadDropboxFiles()}
                disabled={isLoadingDropboxFiles}
                data-testid="button-refresh-dropbox"
                className="h-7 px-2 shrink-0"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingDropboxFiles ? "animate-spin" : ""}`} />
              </Button>
            </div>

            <ScrollArea className="h-72 border border-border rounded-md">
              {isLoadingDropboxFiles ? (
                <div className="flex items-center justify-center h-full py-8">
                  <div className="text-center space-y-2">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">Loading from Dropbox...</p>
                  </div>
                </div>
              ) : dropboxFiles.length === 0 ? (
                <div className="flex items-center justify-center h-full py-8">
                  <div className="text-center space-y-2">
                    <Cloud className="w-8 h-8 mx-auto text-muted-foreground/40" />
                    <p className="text-sm text-muted-foreground">This folder is empty</p>
                    <p className="text-xs text-muted-foreground">Upload a file to add it here</p>
                  </div>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {dropboxFiles.map(file => (
                    <button
                      key={file.id}
                      data-testid={`dropbox-file-${file.id}`}
                      onClick={() => file.type === "folder" ? navigateToFolder(file.path) : shareDropboxFile(file)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover-elevate"
                    >
                      <div className="w-8 h-8 rounded-md bg-[#0061FF]/10 flex items-center justify-center shrink-0">
                        {file.type === "folder"
                          ? <FolderOpen className="w-4 h-4 text-[#0061FF]" />
                          : <SiDropbox className="w-4 h-4 text-[#0061FF]" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{file.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {file.type === "folder" ? "Folder" : file.size ? formatBytes(file.size) : "File"}
                          {file.modified ? ` · ${format(new Date(file.modified), "MMM d, yyyy")}` : ""}
                        </p>
                      </div>
                      {file.type === "folder"
                        ? <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                        : <span className="text-xs text-primary shrink-0">Share</span>}
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>

            <div className="flex items-center gap-2 pt-1 border-t border-border">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => dropboxInputRef.current?.click()}
                data-testid="button-upload-to-dropbox"
                className="flex-1"
              >
                <SiDropbox className="w-3.5 h-3.5 mr-2 text-[#0061FF]" />
                Upload to {currentDropboxFolder ? `…/${currentDropboxFolder.split('/').pop()}` : 'Dropbox'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Google Doc share dialog */}
      <Dialog open={isGoogleDocDialogOpen} onOpenChange={(open) => { setIsGoogleDocDialogOpen(open); if (!open) { setGoogleDocUrl(""); setGoogleDocLabel(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <SiGoogledocs className="w-5 h-5 text-[#4285F4]" />
              Share a Google Doc
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Google link</label>
              <input
                data-testid="input-google-doc-url"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="Paste a Google Docs, Sheets, Slides, or Drive URL…"
                value={googleDocUrl}
                onChange={e => setGoogleDocUrl(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") shareGoogleDoc(); }}
              />
              {googleDocUrl && parseGoogleDocUrl(googleDocUrl) && (
                <div className="pt-1">
                  <GoogleDocCard url={googleDocUrl} fileName={googleDocLabel.trim() || undefined} />
                </div>
              )}
              {googleDocUrl && !parseGoogleDocUrl(googleDocUrl) && (
                <p className="text-xs text-destructive">Not a valid Google Docs, Sheets, Slides, or Drive URL.</p>
              )}
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Label <span className="text-muted-foreground font-normal">(optional)</span></label>
              <input
                data-testid="input-google-doc-label"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="e.g. Q2 Budget Spreadsheet"
                value={googleDocLabel}
                onChange={e => setGoogleDocLabel(e.target.value)}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={() => setIsGoogleDocDialogOpen(false)}>Cancel</Button>
              <Button
                size="sm"
                data-testid="button-share-google-doc"
                disabled={!googleDocUrl || !parseGoogleDocUrl(googleDocUrl)}
                onClick={shareGoogleDoc}
              >
                Share
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
