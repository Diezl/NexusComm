import { useState, useCallback, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ChatWindow } from "@/components/chat-window";
import { EmployeeDirectory } from "@/components/employee-directory";
import { CallOverlay } from "@/components/call-overlay";
import { SSHTerminal } from "@/components/ssh-terminal";
import { MediaPlayer } from "@/components/media-player";
import { TelegramMonitor } from "@/components/telegram-monitor";
import { useWebSocket } from "@/hooks/use-websocket";
import { useActivityTracker } from "@/hooks/use-activity-tracker";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Moon, Sun } from "lucide-react";
import type { ChannelWithMeta, UserPublic, MessageWithUser } from "@shared/schema";

type ActiveView =
  | { type: "channel"; id: string }
  | { type: "dm"; id: string }
  | { type: "directory" }
  | { type: "ssh" }
  | { type: "media" };

type CallState = {
  type: "audio" | "video";
  direction: "incoming" | "outgoing";
  status: "ringing" | "connected" | "ended";
  remoteUser: UserPublic;
};

function useTheme() {
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem("theme");
    if (saved) return saved === "dark";
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);
  return { dark, toggle: () => setDark(d => !d) };
}

export default function ChatPage() {
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { dark, toggle: toggleTheme } = useTheme();
  const [activeView, setActiveView] = useState<ActiveView | null>(null);
  const [messages, setMessages] = useState<Map<string, MessageWithUser[]>>(new Map());
  const [typingUsers, setTypingUsers] = useState<Map<string, Set<string>>>(new Map());
  const [callState, setCallState] = useState<CallState | null>(null);
  const [incomingCallData, setIncomingCallData] = useState<any>(null);
  const [userStatuses, setUserStatuses] = useState<Map<string, string>>(new Map());
  const [unreadDMs, setUnreadDMs] = useState<Set<string>>(new Set());
  const [telegramPanelOpen, setTelegramPanelOpen] = useState(false);
  const [incomingTgMessage, setIncomingTgMessage] = useState<any>(null);
  const [incomingTgChats, setIncomingTgChats] = useState<any[] | null>(null);
  const [telegramUnread, setTelegramUnread] = useState(0);

  const { data: channels = [] } = useQuery<ChannelWithMeta[]>({
    queryKey: ["/api/channels"],
    enabled: !!user,
  });

  const { data: rawUsers = [] } = useQuery<UserPublic[]>({
    queryKey: ["/api/users"],
    enabled: !!user,
  });

  const allUsers: UserPublic[] = rawUsers.map(u => ({
    ...u,
    status: userStatuses.get(u.id) || u.status,
  }));

  const getConversationKey = useCallback((view: ActiveView | null) => {
    if (!view) return null;
    if (view.type === "channel") return `ch:${view.id}`;
    if (view.type === "dm") return `dm:${view.id}`;
    return null;
  }, []);

  const currentMessages = activeView ? (messages.get(getConversationKey(activeView) || "") || []) : [];

  async function loadMessages(view: ActiveView) {
    const key = getConversationKey(view);
    if (!key || messages.has(key)) return;
    try {
      let url = "";
      if (view.type === "channel") url = `/api/messages/channel/${view.id}`;
      else if (view.type === "dm") url = `/api/messages/dm/${view.id}`;
      if (!url) return;
      const res = await fetch(url, { credentials: "include" });
      const data: MessageWithUser[] = await res.json();
      setMessages(m => new Map(m).set(key, data));
    } catch {}
  }

  async function changeStatus(status: string) {
    await apiRequest("PATCH", "/api/users/me/status", { status });
    queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
  }

  const handleMessage = useCallback((msg: MessageWithUser) => {
    const key = msg.channelId
      ? `ch:${msg.channelId}`
      : msg.toUserId === user?.id
        ? `dm:${msg.fromUserId}`
        : `dm:${msg.toUserId}`;

    setMessages(prev => {
      const existing = prev.get(key) || [];
      if (existing.find(m => m.id === msg.id)) return prev;
      return new Map(prev).set(key, [...existing, msg]);
    });

    if (!msg.channelId && msg.fromUserId !== user?.id) {
      const isViewingDM = activeView?.type === "dm" && activeView.id === msg.fromUserId;
      if (!isViewingDM) {
        setUnreadDMs(prev => new Set(prev).add(msg.fromUserId));
      }
    }
  }, [user?.id, activeView]);

  const { send } = useWebSocket(user, {
    onMessage: handleMessage,
    onUserStatus: (userId, status) => {
      setUserStatuses(prev => new Map(prev).set(userId, status));
    },
    onTyping: (userId, channelId, isTyping) => {
      const key = channelId ? `ch:${channelId}` : `dm:${userId}`;
      setTypingUsers(prev => {
        const newMap = new Map(prev);
        const set = new Set(newMap.get(key) || []);
        if (isTyping) set.add(userId); else set.delete(userId);
        newMap.set(key, set);
        return newMap;
      });
    },
    onCallInitiate: (data) => {
      const caller = allUsers.find(u => u.id === data.fromUserId);
      if (!caller) return;
      setCallState({
        type: data.callType || "video",
        direction: "incoming",
        status: "ringing",
        remoteUser: caller,
      });
      setIncomingCallData(data);
    },
    onCallOffer: (data) => {
      if (callState?.status === "ringing" && callState.direction === "incoming") {
        setCallState(prev => prev ? { ...prev, status: "connected" } : null);
        setIncomingCallData(data);
      }
    },
    onCallAnswer: (data) => {
      setCallState(prev => prev ? { ...prev, status: "connected" } : null);
      setIncomingCallData(data);
    },
    onIceCandidate: (data) => {
      setIncomingCallData(data);
    },
    onCallEnd: () => {
      setCallState(null);
      setIncomingCallData(null);
      toast({ title: "Call ended" });
    },
    onCallReject: () => {
      setCallState(null);
      setIncomingCallData(null);
      toast({ title: "Call declined" });
    },
    onScreenShareStart: (data) => {
      setCallState(prev => prev ? { ...prev, isScreenSharing: true } : null as any);
    },
    onScreenShareEnd: () => {
      setCallState(prev => prev ? { ...prev, isScreenSharing: false } : null as any);
    },
    onTelegramMessage: (msg) => {
      setIncomingTgMessage(msg);
      if (!telegramPanelOpen) {
        setTelegramUnread(prev => prev + 1);
      }
    },
    onTelegramChats: (chats) => {
      setIncomingTgChats(chats);
    },
  });

  const activitySection = callState?.status === "connected"
    ? (callState.type === "video" ? "video_call" : "audio_call")
    : activeView?.type === "channel" ? "chat"
    : activeView?.type === "dm" ? "dm"
    : activeView?.type === "media" ? "media"
    : activeView?.type === "ssh" ? "ssh"
    : activeView?.type === "directory" ? "directory"
    : "chat";

  useActivityTracker(activitySection, send, !!user);

  const selectChannel = useCallback(async (channel: ChannelWithMeta) => {
    const view: ActiveView = { type: "channel", id: channel.id };
    setActiveView(view);
    await loadMessages(view);
  }, [messages]);

  const selectDM = useCallback(async (dmUser: UserPublic) => {
    const view: ActiveView = { type: "dm", id: dmUser.id };
    setActiveView(view);
    setUnreadDMs(prev => {
      const next = new Set(prev);
      next.delete(dmUser.id);
      return next;
    });
    await loadMessages(view);
  }, [messages]);

  useEffect(() => {
    if (channels.length > 0 && !activeView) {
      const general = channels.find(c => c.name === "general") || channels[0];
      if (general) selectChannel(general);
    }
  }, [channels]);

  function startCall(type: "audio" | "video", targetUserId: string) {
    const remoteUser = allUsers.find(u => u.id === targetUserId);
    if (!remoteUser) return;
    setCallState({ type, direction: "outgoing", status: "ringing", remoteUser });
    send({ type: "call_initiate", targetUserId, callType: type });
  }

  function endCall() {
    setCallState(null);
    setIncomingCallData(null);
  }

  if (!user) return null;

  const activeChannel = activeView?.type === "channel"
    ? channels.find(c => c.id === activeView.id)
    : undefined;

  const activeDMUser = activeView?.type === "dm"
    ? allUsers.find(u => u.id === activeView.id)
    : undefined;

  const typingKey = getConversationKey(activeView) || "";
  const currentTypingUsers = typingUsers.get(typingKey) || new Set<string>();

  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full overflow-hidden">
        <AppSidebar
          currentUser={user}
          channels={channels}
          users={allUsers}
          activeView={activeView}
          onSelectChannel={selectChannel}
          onSelectDM={selectDM}
          onSelectDirectory={() => setActiveView({ type: "directory" })}
          onSelectSSH={() => setActiveView({ type: "ssh" })}
          onSelectMedia={() => setActiveView({ type: "media" })}
          onToggleTelegram={() => {
            setTelegramPanelOpen(open => !open);
            setTelegramUnread(0);
          }}
          telegramPanelOpen={telegramPanelOpen}
          telegramUnread={telegramUnread}
          onLogout={() => logout.mutate()}
          onStatusChange={changeStatus}
          unreadDMs={unreadDMs}
        />

        {telegramPanelOpen && (
          <div className="flex-none w-80 border-r border-border overflow-hidden flex flex-col" data-testid="panel-telegram">
            <TelegramMonitor
              incomingMessage={incomingTgMessage}
              incomingChats={incomingTgChats}
            />
          </div>
        )}

        <div className="flex flex-col flex-1 overflow-hidden">
          <header className="flex items-center justify-between px-3 py-2 border-b border-border bg-card shrink-0 h-12">
            <SidebarTrigger data-testid="button-sidebar-toggle" />
            <Button
              size="icon"
              variant="ghost"
              data-testid="button-theme-toggle"
              onClick={toggleTheme}
            >
              {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </Button>
          </header>

          <main className="flex-1 overflow-hidden">
            {activeView?.type === "ssh" && <SSHTerminal />}
            {activeView?.type === "media" && <MediaPlayer />}

            {activeView?.type === "directory" && (
              <EmployeeDirectory
                users={allUsers}
                currentUser={user}
                onDMUser={selectDM}
                onCallUser={startCall}
              />
            )}

            {(activeView?.type === "channel" || activeView?.type === "dm") && (
              <ChatWindow
                type={activeView.type}
                channel={activeChannel}
                dmUser={activeDMUser}
                currentUser={user}
                messages={currentMessages}
                onMessage={send}
                onLocalMessage={handleMessage}
                onStartCall={startCall}
                typingUsers={currentTypingUsers}
                allUsers={allUsers}
              />
            )}

            {!activeView && (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <p className="text-muted-foreground">Select a channel or person to start messaging</p>
                </div>
              </div>
            )}
          </main>
        </div>
      </div>

      {callState && (
        <CallOverlay
          callState={callState}
          send={send}
          currentUser={user}
          onCallEnd={endCall}
          incomingCallData={incomingCallData}
        />
      )}
    </SidebarProvider>
  );
}
