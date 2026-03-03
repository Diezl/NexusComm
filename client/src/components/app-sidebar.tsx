import { useState } from "react";
import { useLocation } from "wouter";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Hash, Users, Plus, ChevronDown, Shield,
  Circle, LogOut, Settings, User, Terminal, ExternalLink, Globe, Tv, Monitor
} from "lucide-react";
import { SiTelegram } from "react-icons/si";
import type { ChannelWithMeta, UserPublic } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { useQueryClient } from "@tanstack/react-query";

type Props = {
  currentUser: UserPublic;
  channels: ChannelWithMeta[];
  users: UserPublic[];
  activeView: { type: "channel" | "dm" | "directory" | "ssh" | "media"; id: string } | null;
  onSelectChannel: (channel: ChannelWithMeta) => void;
  onSelectDM: (user: UserPublic) => void;
  onSelectDirectory: () => void;
  onSelectSSH: () => void;
  onSelectMedia: () => void;
  onToggleTelegram: () => void;
  telegramPanelOpen: boolean;
  telegramUnread?: number;
  onLogout: () => void;
  onStatusChange: (status: string) => void;
  unreadDMs?: Set<string>;
};

function getInitials(name: string) {
  return name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
}

const STATUS_COLORS: Record<string, string> = {
  online: "bg-status-online",
  away: "bg-status-away",
  busy: "bg-status-busy",
  offline: "bg-status-offline",
};

const STATUS_LABELS: Record<string, string> = {
  online: "Online",
  away: "Away",
  busy: "Busy",
  offline: "Appear Offline",
};

export function AppSidebar({
  currentUser, channels, users, activeView,
  onSelectChannel, onSelectDM, onSelectDirectory, onSelectSSH, onSelectMedia,
  onToggleTelegram, telegramPanelOpen, telegramUnread = 0,
  onLogout, onStatusChange, unreadDMs = new Set(),
}: Props) {
  const [isNewChannelOpen, setIsNewChannelOpen] = useState(false);
  const [newChannelName, setNewChannelName] = useState("");
  const [newChannelDesc, setNewChannelDesc] = useState("");
  const queryClient = useQueryClient();
  const dmUsers = users.filter(u => u.id !== currentUser.id);

  const onlineUsers = dmUsers.filter(u => u.status === "online");
  const recentDMs = dmUsers.slice(0, 8);

  async function createChannel() {
    if (!newChannelName.trim()) return;
    await apiRequest("POST", "/api/channels", {
      name: newChannelName.trim(),
      description: newChannelDesc.trim(),
    });
    queryClient.invalidateQueries({ queryKey: ["/api/channels"] });
    setIsNewChannelOpen(false);
    setNewChannelName("");
    setNewChannelDesc("");
  }

  return (
    <>
      <Sidebar>
        <SidebarHeader className="p-3 border-b border-sidebar-border">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center shrink-0">
              <Shield className="w-4 h-4 text-primary-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-sm tracking-tight truncate">NexusComm</p>
              <p className="text-xs text-muted-foreground truncate">Private Workspace</p>
            </div>
          </div>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel className="flex items-center justify-between pr-1">
              <span>Channels</span>
              <Button
                size="icon"
                variant="ghost"
                className="h-5 w-5"
                data-testid="button-new-channel"
                onClick={() => setIsNewChannelOpen(true)}
              >
                <Plus className="w-3.5 h-3.5" />
              </Button>
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {channels.map(channel => (
                  <SidebarMenuItem key={channel.id}>
                    <SidebarMenuButton
                      data-testid={`channel-${channel.id}`}
                      isActive={activeView?.type === "channel" && activeView.id === channel.id}
                      onClick={() => onSelectChannel(channel)}
                    >
                      <Hash className="w-4 h-4 shrink-0" />
                      <span className="truncate">{channel.name}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
                {channels.length === 0 && (
                  <p className="text-xs text-muted-foreground px-2 py-1">No channels yet</p>
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarSeparator />

          <SidebarGroup>
            <SidebarGroupLabel>
              <button
                data-testid="button-directory"
                className="flex items-center gap-1.5 hover:text-foreground transition-colors"
                onClick={onSelectDirectory}
              >
                <Users className="w-3.5 h-3.5" />
                <span>People</span>
              </button>
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {recentDMs.map(user => (
                  <SidebarMenuItem key={user.id}>
                    <SidebarMenuButton
                      data-testid={`dm-${user.id}`}
                      isActive={activeView?.type === "dm" && activeView.id === user.id}
                      onClick={() => onSelectDM(user)}
                    >
                      <div className="relative shrink-0">
                        <Avatar className="w-5 h-5">
                          <AvatarFallback className="text-[10px] bg-primary/10 text-primary">
                            {getInitials(user.displayName)}
                          </AvatarFallback>
                        </Avatar>
                        <span className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-sidebar ${STATUS_COLORS[user.status] || STATUS_COLORS.offline}`} />
                      </div>
                      <span className="truncate flex-1">{user.displayName}</span>
                      {unreadDMs.has(user.id) && (
                        <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
                      )}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
          <SidebarSeparator />

          <SidebarGroup>
            <SidebarGroupLabel>Tools</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    data-testid="button-ssh-terminal"
                    isActive={activeView?.type === "ssh"}
                    onClick={onSelectSSH}
                  >
                    <Terminal className="w-4 h-4 shrink-0" />
                    <span>SSH Terminal</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    data-testid="button-media-player"
                    isActive={activeView?.type === "media"}
                    onClick={onSelectMedia}
                  >
                    <Tv className="w-4 h-4 shrink-0" style={{ color: activeView?.type === "media" ? undefined : "#FF8C00" }} />
                    <span>Media Player</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    data-testid="button-telegram-monitor"
                    isActive={telegramPanelOpen}
                    onClick={onToggleTelegram}
                  >
                    <SiTelegram className="w-4 h-4 shrink-0" style={{ color: "#2AABEE" }} />
                    <span className="flex-1">Telegram Monitor</span>
                    {telegramUnread > 0 && (
                      <Badge className="text-[10px] h-4 min-w-[16px] px-1 bg-[#2AABEE] text-white border-0" data-testid="badge-telegram-unread">
                        {telegramUnread > 99 ? "99+" : telegramUnread}
                      </Badge>
                    )}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          <SidebarSeparator />

          <SidebarGroup>
            <SidebarGroupLabel>Quick Links</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {[
                  { label: "PDS Admin", url: "https://pdslive.media/admin", icon: Globe },
                  { label: "Seismic Panel", url: "http://seismic.sx:8087/login", icon: Tv },
                  { label: "P2S Panel", url: "http://p2smrbponly.net:8087/login", icon: Tv },
                  { label: "OTWT Panel", url: "http://onlytimewilltell.xyz:8087/login", icon: Tv },
                  { label: "Termius", url: "https://termius.com/index.html", icon: Monitor },
                ].map(({ label, url, icon: Icon }) => (
                  <SidebarMenuItem key={url}>
                    <SidebarMenuButton
                      asChild
                      data-testid={`link-${label.toLowerCase().replace(/\s+/g, "-")}`}
                    >
                      <a href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 w-full">
                        <Icon className="w-4 h-4 shrink-0" />
                        <span className="truncate flex-1">{label}</span>
                        <ExternalLink className="w-3 h-3 shrink-0 text-muted-foreground/60" />
                      </a>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter className="p-2 border-t border-sidebar-border">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                data-testid="button-user-menu"
                className="flex items-center gap-2.5 w-full px-2 py-1.5 rounded-md hover-elevate text-left"
              >
                <div className="relative shrink-0">
                  <Avatar className="w-8 h-8">
                    <AvatarFallback className="text-xs bg-primary/10 text-primary font-semibold">
                      {getInitials(currentUser.displayName)}
                    </AvatarFallback>
                  </Avatar>
                  <span className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2 border-sidebar ${STATUS_COLORS[currentUser.status] || STATUS_COLORS.offline}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{currentUser.displayName}</p>
                  <p className="text-xs text-muted-foreground capitalize truncate">{currentUser.status}</p>
                </div>
                <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <div className="px-2 py-1.5">
                <p className="text-sm font-medium">{currentUser.displayName}</p>
                <p className="text-xs text-muted-foreground">@{currentUser.username}</p>
              </div>
              <DropdownMenuSeparator />
              <p className="text-xs text-muted-foreground px-2 py-1">Set status</p>
              {["online", "away", "busy", "offline"].map(s => (
                <DropdownMenuItem key={s} onClick={() => onStatusChange(s)} data-testid={`status-${s}`}>
                  <span className={`w-2 h-2 rounded-full mr-2 ${STATUS_COLORS[s]}`} />
                  {STATUS_LABELS[s]}
                  {currentUser.status === s && <span className="ml-auto text-primary text-xs">Active</span>}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onLogout} data-testid="button-logout" className="text-destructive">
                <LogOut className="w-4 h-4 mr-2" />
                Sign Out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarFooter>
      </Sidebar>

      <Dialog open={isNewChannelOpen} onOpenChange={setIsNewChannelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create a channel</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Channel name</Label>
              <Input
                data-testid="input-channel-name"
                placeholder="e.g. team-updates"
                value={newChannelName}
                onChange={e => setNewChannelName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Description (optional)</Label>
              <Input
                data-testid="input-channel-desc"
                placeholder="What's this channel about?"
                value={newChannelDesc}
                onChange={e => setNewChannelDesc(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setIsNewChannelOpen(false)}>Cancel</Button>
            <Button data-testid="button-create-channel" onClick={createChannel} disabled={!newChannelName.trim()}>
              Create Channel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
