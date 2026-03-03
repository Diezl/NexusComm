import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Send, Bot, AlertCircle, Plus, Pin, PinOff, RefreshCw,
  MessageSquare, Users, Megaphone, User, ChevronLeft, X
} from "lucide-react";
import { SiTelegram } from "react-icons/si";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

type TgMessage = {
  id: number;
  chatId: number;
  chatTitle: string;
  chatType: string;
  text: string;
  fromName: string;
  fromUsername?: string;
  date: number;
  mediaType?: string;
  replyToText?: string;
};

type TgChat = {
  id: number;
  title: string;
  type: string;
  username?: string;
  pinned: boolean;
  unread: number;
  lastMessage?: TgMessage;
};

type BotStatus = {
  configured: boolean;
  running: boolean;
  error: string | null;
  bot: { id: number; username: string; first_name: string } | null;
};

type Props = {
  onTelegramMessage?: (msg: TgMessage) => void;
  onTelegramChats?: (chats: TgChat[]) => void;
  incomingMessage?: TgMessage | null;
  incomingChats?: TgChat[] | null;
};

function chatIcon(type: string) {
  switch (type) {
    case "supergroup":
    case "group": return <Users className="w-3.5 h-3.5" />;
    case "channel": return <Megaphone className="w-3.5 h-3.5" />;
    default: return <User className="w-3.5 h-3.5" />;
  }
}

function mediaIcon(mediaType?: string) {
  switch (mediaType) {
    case "photo": return "🖼️ ";
    case "video": return "🎬 ";
    case "audio": return "🎵 ";
    case "voice": return "🎤 ";
    case "document": return "📎 ";
    case "sticker": return "😄 ";
    default: return "";
  }
}

function formatTime(unixSec: number) {
  const d = new Date(unixSec * 1000);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  return isToday
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function TelegramMonitor({ incomingMessage, incomingChats }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selectedChatId, setSelectedChatId] = useState<number | null>(null);
  const [addInput, setAddInput] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [localMessages, setLocalMessages] = useState<TgMessage[]>([]);
  const [localChats, setLocalChats] = useState<TgChat[]>([]);

  const { data: status } = useQuery<BotStatus>({
    queryKey: ["/api/telegram/status"],
    refetchInterval: 10000,
  });

  const { data: serverChats = [] } = useQuery<TgChat[]>({
    queryKey: ["/api/telegram/chats"],
    refetchInterval: 5000,
  });

  const { data: serverMessages = [], isLoading: loadingMsgs } = useQuery<TgMessage[]>({
    queryKey: ["/api/telegram/messages", selectedChatId],
    enabled: !!selectedChatId,
    queryFn: async () => {
      if (!selectedChatId) return [];
      const res = await fetch(`/api/telegram/messages/${selectedChatId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch messages");
      return res.json();
    },
    refetchInterval: false,
  });

  useEffect(() => {
    const merged = [...serverChats];
    localChats.forEach((lc) => {
      if (!merged.find((c) => c.id === lc.id)) merged.push(lc);
    });
    setLocalChats(merged);
  }, [serverChats]);

  useEffect(() => {
    if (incomingChats) {
      setLocalChats(incomingChats);
    }
  }, [incomingChats]);

  useEffect(() => {
    setLocalMessages(serverMessages);
  }, [serverMessages]);

  useEffect(() => {
    if (!incomingMessage) return;
    if (incomingMessage.chatId === selectedChatId) {
      setLocalMessages((prev) => {
        if (prev.find((m) => m.id === incomingMessage.id)) return prev;
        return [...prev, incomingMessage];
      });
    }
    setLocalChats((prev) => {
      const idx = prev.findIndex((c) => c.id === incomingMessage.chatId);
      if (idx === -1) {
        return [
          {
            id: incomingMessage.chatId,
            title: incomingMessage.chatTitle,
            type: incomingMessage.chatType,
            pinned: false,
            unread: incomingMessage.chatId === selectedChatId ? 0 : 1,
            lastMessage: incomingMessage,
          },
          ...prev,
        ];
      }
      const updated = [...prev];
      updated[idx] = {
        ...updated[idx],
        lastMessage: incomingMessage,
        unread: incomingMessage.chatId === selectedChatId ? 0 : updated[idx].unread + 1,
      };
      return updated.sort((a, b) => (b.lastMessage?.date ?? 0) - (a.lastMessage?.date ?? 0));
    });
  }, [incomingMessage]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [localMessages]);

  const addMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", "/api/telegram/chats/add", { id });
      return res.json();
    },
    onSuccess: (chat: TgChat) => {
      setLocalChats((prev) => {
        if (prev.find((c) => c.id === chat.id)) return prev;
        return [chat, ...prev];
      });
      setSelectedChatId(chat.id);
      setAddInput("");
      setShowAdd(false);
      toast({ title: `Added: ${chat.title}` });
    },
    onError: (err: any) => {
      toast({ title: "Failed to add chat", description: err.message, variant: "destructive" });
    },
  });

  const pinMutation = useMutation({
    mutationFn: async ({ chatId, pinned }: { chatId: number; pinned: boolean }) => {
      await apiRequest("PATCH", `/api/telegram/chats/${chatId}/pin`, { pinned });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/telegram/chats"] }),
  });

  const selectChat = useCallback((chatId: number) => {
    setSelectedChatId(chatId);
    setLocalChats((prev) =>
      prev.map((c) => (c.id === chatId ? { ...c, unread: 0 } : c))
    );
    qc.invalidateQueries({ queryKey: ["/api/telegram/messages", chatId] });
  }, [qc]);

  const selectedChat = localChats.find((c) => c.id === selectedChatId);
  const sortedChats = [...localChats].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return (b.lastMessage?.date ?? 0) - (a.lastMessage?.date ?? 0);
  });

  return (
    <div className="flex flex-col h-full bg-background border-r border-border w-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-3 border-b border-border bg-muted/30">
        <SiTelegram className="w-5 h-5 text-[#2AABEE]" />
        <span className="font-semibold text-sm flex-1">Telegram Monitor</span>
        {status?.running ? (
          <Badge variant="secondary" className="text-xs bg-green-500/15 text-green-600 border-green-500/30" data-testid="status-bot-online">
            Live
          </Badge>
        ) : status?.configured ? (
          <Badge variant="secondary" className="text-xs bg-yellow-500/15 text-yellow-600 border-yellow-500/30">
            Connecting…
          </Badge>
        ) : (
          <Badge variant="secondary" className="text-xs bg-red-500/15 text-red-600 border-red-500/30">
            No token
          </Badge>
        )}
      </div>

      {/* Bot error/not configured notice */}
      {!status?.configured && (
        <div className="mx-3 mt-3 p-3 rounded-md bg-amber-500/10 border border-amber-500/20 text-xs text-amber-700 dark:text-amber-400 flex gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            Add <code className="font-mono bg-amber-500/15 px-1 rounded">TELEGRAM_BOT_TOKEN</code> to Secrets to enable live monitoring.
          </span>
        </div>
      )}

      {status?.running && status.bot && (
        <div className="px-3 pt-2 pb-1 text-xs text-muted-foreground">
          Bot: <span className="font-medium text-foreground">@{status.bot.username}</span>
        </div>
      )}

      {/* Chat list */}
      {!selectedChatId ? (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex items-center gap-2 px-3 py-2">
            <span className="text-xs font-medium text-muted-foreground flex-1">Monitored Chats</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => setShowAdd(!showAdd)}
              data-testid="button-add-chat"
            >
              <Plus className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => qc.invalidateQueries({ queryKey: ["/api/telegram/chats"] })}
              data-testid="button-refresh-chats"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </Button>
          </div>

          {showAdd && (
            <div className="px-3 pb-2 flex gap-1.5">
              <Input
                value={addInput}
                onChange={(e) => setAddInput(e.target.value)}
                placeholder="@username or chat ID"
                className="h-7 text-xs"
                data-testid="input-add-chat"
                onKeyDown={(e) => e.key === "Enter" && addInput && addMutation.mutate(addInput)}
              />
              <Button
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={!addInput || addMutation.isPending}
                onClick={() => addMutation.mutate(addInput)}
                data-testid="button-add-chat-confirm"
              >
                {addMutation.isPending ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
              </Button>
            </div>
          )}

          <ScrollArea className="flex-1">
            {sortedChats.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p>No chats yet.</p>
                <p className="mt-1">Add the bot to a Telegram group or channel.</p>
              </div>
            ) : (
              <div className="space-y-0.5 p-2">
                {sortedChats.map((chat) => (
                  <div
                    key={chat.id}
                    className={cn(
                      "group flex items-start gap-2.5 px-2.5 py-2 rounded-md cursor-pointer transition-colors",
                      "hover:bg-muted/60"
                    )}
                    onClick={() => selectChat(chat.id)}
                    data-testid={`chat-item-${chat.id}`}
                  >
                    <div className="mt-0.5 p-1.5 rounded-full bg-[#2AABEE]/15 text-[#2AABEE] shrink-0">
                      {chatIcon(chat.type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1 min-w-0">
                        <span className="text-sm font-medium truncate flex-1">{chat.title}</span>
                        {chat.lastMessage && (
                          <span className="text-[10px] text-muted-foreground shrink-0">
                            {formatTime(chat.lastMessage.date)}
                          </span>
                        )}
                      </div>
                      {chat.lastMessage && (
                        <p className="text-xs text-muted-foreground truncate">
                          <span className="font-medium">{chat.lastMessage.fromName}: </span>
                          {mediaIcon(chat.lastMessage.mediaType)}{chat.lastMessage.text}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      {chat.unread > 0 && (
                        <Badge className="text-[10px] h-4 min-w-[16px] px-1 bg-[#2AABEE] text-white border-0" data-testid={`badge-unread-${chat.id}`}>
                          {chat.unread > 99 ? "99+" : chat.unread}
                        </Badge>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => {
                          e.stopPropagation();
                          pinMutation.mutate({ chatId: chat.id, pinned: !chat.pinned });
                        }}
                        data-testid={`button-pin-${chat.id}`}
                      >
                        {chat.pinned ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3" />}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      ) : (
        /* Message view */
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex items-center gap-2 px-2 py-2 border-b border-border bg-muted/20">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setSelectedChatId(null)}
              data-testid="button-back-chats"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{selectedChat?.title ?? "Chat"}</p>
              {selectedChat?.username && (
                <p className="text-[10px] text-muted-foreground">@{selectedChat.username}</p>
              )}
            </div>
            <div className="text-[#2AABEE]">{chatIcon(selectedChat?.type ?? "")}</div>
          </div>

          <ScrollArea className="flex-1">
            {loadingMsgs ? (
              <div className="flex justify-center py-8">
                <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            ) : localMessages.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p>No messages yet in this session.</p>
              </div>
            ) : (
              <div className="px-2 py-2 space-y-1">
                {localMessages.map((msg, idx) => {
                  const prevMsg = localMessages[idx - 1];
                  const sameFrom = prevMsg?.fromName === msg.fromName;
                  return (
                    <div key={`${msg.id}-${idx}`} className="group" data-testid={`msg-${msg.id}`}>
                      {!sameFrom && (
                        <p className="text-[10px] font-semibold text-[#2AABEE] mt-2 mb-0.5 px-1">
                          {msg.fromName}
                          {msg.fromUsername ? ` @${msg.fromUsername}` : ""}
                          <span className="text-[10px] font-normal text-muted-foreground ml-1.5">
                            {formatTime(msg.date)}
                          </span>
                        </p>
                      )}
                      {msg.replyToText && (
                        <div className="ml-1 mb-0.5 pl-2 border-l-2 border-[#2AABEE]/50 text-[10px] text-muted-foreground italic truncate">
                          {msg.replyToText}
                        </div>
                      )}
                      <div className="px-1 py-0.5 rounded text-xs text-foreground leading-relaxed hover:bg-muted/40">
                        {mediaIcon(msg.mediaType)}
                        {msg.text}
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>
            )}
          </ScrollArea>

          <div className="px-3 py-2 border-t border-border text-center text-[10px] text-muted-foreground">
            Read-only monitoring
          </div>
        </div>
      )}
    </div>
  );
}
