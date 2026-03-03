import { useState } from "react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Search, MessageSquare, Phone, Video,
  Users, Building, Crown, Shield, User
} from "lucide-react";
import type { UserPublic } from "@shared/schema";

type Props = {
  users: UserPublic[];
  currentUser: UserPublic;
  onDMUser: (user: UserPublic) => void;
  onCallUser: (type: "audio" | "video", userId: string) => void;
};

function getInitials(name: string) {
  return name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    online: "bg-status-online",
    away: "bg-status-away",
    busy: "bg-status-busy",
    offline: "bg-status-offline",
  };
  const labels: Record<string, string> = {
    online: "Online",
    away: "Away",
    busy: "Busy",
    offline: "Offline",
  };
  return (
    <span className={`inline-block w-2 h-2 rounded-full ${colors[status] || colors.offline}`}
      title={labels[status] || "Offline"} />
  );
}

function RoleIcon({ role }: { role: string }) {
  if (role === "admin") return <Crown className="w-3 h-3 text-yellow-500" />;
  if (role === "manager") return <Shield className="w-3 h-3 text-blue-400" />;
  return null;
}

const STATUS_ORDER: Record<string, number> = { online: 0, busy: 1, away: 2, offline: 3 };

export function EmployeeDirectory({ users, currentUser, onDMUser, onCallUser }: Props) {
  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState("all");

  const departments = ["all", ...Array.from(new Set(users.map(u => u.department).filter(Boolean) as string[]))].sort();

  const filtered = users
    .filter(u => u.id !== currentUser.id)
    .filter(u => {
      const q = search.toLowerCase();
      const matchSearch = !q || u.displayName.toLowerCase().includes(q) || u.username.toLowerCase().includes(q) || (u.department || "").toLowerCase().includes(q);
      const matchDept = deptFilter === "all" || u.department === deptFilter;
      return matchSearch && matchDept;
    })
    .sort((a, b) => (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3) || a.displayName.localeCompare(b.displayName));

  const onlineCount = users.filter(u => u.status === "online").length;

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="px-4 py-3 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center">
            <Users className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h2 className="font-semibold text-sm">Employee Directory</h2>
            <p className="text-xs text-muted-foreground">
              {onlineCount} online · {users.length} total
            </p>
          </div>
        </div>
      </div>

      <div className="px-4 py-3 border-b border-border bg-card/50 space-y-2 shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            data-testid="input-employee-search"
            placeholder="Search by name or department..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {departments.map(dept => (
            <button
              key={dept}
              data-testid={`filter-dept-${dept}`}
              onClick={() => setDeptFilter(dept)}
              className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
                deptFilter === dept
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-transparent border-border text-muted-foreground hover-elevate"
              }`}
            >
              {dept === "all" ? "All" : dept}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <User className="w-12 h-12 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">No employees match your search</p>
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map(user => (
            <Card key={user.id} data-testid={`card-employee-${user.id}`}>
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="relative shrink-0">
                    <Avatar className="w-12 h-12">
                      <AvatarFallback className="text-sm font-semibold bg-primary/10 text-primary">
                        {getInitials(user.displayName)}
                      </AvatarFallback>
                    </Avatar>
                    <span className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-card ${
                      user.status === "online" ? "bg-status-online" :
                      user.status === "away" ? "bg-status-away" :
                      user.status === "busy" ? "bg-status-busy" : "bg-status-offline"
                    }`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-semibold text-sm truncate">{user.displayName}</span>
                      <RoleIcon role={user.role} />
                    </div>
                    <p className="text-xs text-muted-foreground truncate">@{user.username}</p>
                    {user.department && (
                      <div className="flex items-center gap-1 mt-1">
                        <Building className="w-3 h-3 text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">{user.department}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-1.5 mt-1.5">
                      <StatusDot status={user.status} />
                      <span className="text-xs text-muted-foreground capitalize">{user.status}</span>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 mt-3 pt-3 border-t border-border">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="sm"
                        variant="secondary"
                        className="flex-1"
                        data-testid={`button-dm-${user.id}`}
                        onClick={() => onDMUser(user)}
                      >
                        <MessageSquare className="w-3.5 h-3.5 mr-1.5" />
                        Message
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Send a message</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="icon"
                        variant="secondary"
                        data-testid={`button-call-audio-${user.id}`}
                        onClick={() => onCallUser("audio", user.id)}
                        disabled={user.status === "offline"}
                      >
                        <Phone className="w-3.5 h-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Voice call</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="icon"
                        variant="secondary"
                        data-testid={`button-call-video-${user.id}`}
                        onClick={() => onCallUser("video", user.id)}
                        disabled={user.status === "offline"}
                      >
                        <Video className="w-3.5 h-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Video call</TooltipContent>
                  </Tooltip>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
