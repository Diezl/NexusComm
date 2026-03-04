import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Shield, Users, Hash, MessageSquare, Wifi, ArrowLeft,
  Pencil, Trash2, Plus, Key, UserPlus, RefreshCw,
} from "lucide-react";
import type { UserPublic, ChannelWithMeta } from "@shared/schema";

function getInitials(name: string) {
  return name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
}

const ROLE_COLORS: Record<string, string> = {
  admin: "bg-red-500/10 text-red-600 border-red-200 dark:border-red-800",
  manager: "bg-blue-500/10 text-blue-600 border-blue-200 dark:border-blue-800",
  employee: "bg-green-500/10 text-green-600 border-green-200 dark:border-green-800",
};

const STATUS_COLORS: Record<string, string> = {
  online: "bg-green-500",
  away: "bg-yellow-500",
  busy: "bg-red-500",
  offline: "bg-gray-400",
};

export default function AdminPage() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [editUser, setEditUser] = useState<UserPublic | null>(null);
  const [editForm, setEditForm] = useState({ displayName: "", role: "", department: "", password: "" });
  const [createUserOpen, setCreateUserOpen] = useState(false);
  const [createUserForm, setCreateUserForm] = useState({ username: "", password: "", displayName: "", role: "employee", department: "" });
  const [deleteUserId, setDeleteUserId] = useState<string | null>(null);
  const [createChannelOpen, setCreateChannelOpen] = useState(false);
  const [createChannelForm, setCreateChannelForm] = useState({ name: "", description: "" });
  const [deleteChannelId, setDeleteChannelId] = useState<string | null>(null);

  const { data: stats, isLoading: statsLoading } = useQuery<{ totalUsers: number; totalChannels: number; onlineUsers: number; totalMessages: number }>({
    queryKey: ["/api/admin/stats"],
  });

  const { data: adminUsers = [], isLoading: usersLoading } = useQuery<UserPublic[]>({
    queryKey: ["/api/admin/users"],
  });

  const { data: adminChannels = [], isLoading: channelsLoading } = useQuery<ChannelWithMeta[]>({
    queryKey: ["/api/admin/channels"],
  });

  const updateUserMutation = useMutation({
    mutationFn: (data: { id: string; body: object }) =>
      apiRequest("PATCH", `/api/admin/users/${data.id}`, data.body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      setEditUser(null);
      toast({ title: "User updated successfully" });
    },
    onError: (e: any) => toast({ title: "Failed to update user", description: e.message, variant: "destructive" }),
  });

  const createUserMutation = useMutation({
    mutationFn: (body: object) => apiRequest("POST", "/api/admin/users", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      setCreateUserOpen(false);
      setCreateUserForm({ username: "", password: "", displayName: "", role: "employee", department: "" });
      toast({ title: "User created successfully" });
    },
    onError: (e: any) => toast({ title: "Failed to create user", description: e.message, variant: "destructive" }),
  });

  const deleteUserMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/admin/users/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      setDeleteUserId(null);
      toast({ title: "User deleted" });
    },
    onError: (e: any) => toast({ title: "Failed to delete user", description: e.message, variant: "destructive" }),
  });

  const createChannelMutation = useMutation({
    mutationFn: (body: object) => apiRequest("POST", "/api/admin/channels", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/channels"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/channels"] });
      setCreateChannelOpen(false);
      setCreateChannelForm({ name: "", description: "" });
      toast({ title: "Channel created" });
    },
    onError: (e: any) => toast({ title: "Failed to create channel", description: e.message, variant: "destructive" }),
  });

  const deleteChannelMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/admin/channels/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/channels"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/channels"] });
      setDeleteChannelId(null);
      toast({ title: "Channel deleted" });
    },
    onError: (e: any) => toast({ title: "Failed to delete channel", description: e.message, variant: "destructive" }),
  });

  if (!user || user.role !== "admin") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-3">
          <Shield className="w-12 h-12 text-destructive mx-auto" />
          <p className="text-lg font-semibold">Access Denied</p>
          <p className="text-muted-foreground">Admin privileges required.</p>
          <Button onClick={() => setLocation("/")}>Go Back</Button>
        </div>
      </div>
    );
  }

  function openEditUser(u: UserPublic) {
    setEditUser(u);
    setEditForm({ displayName: u.displayName, role: u.role, department: u.department || "", password: "" });
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border bg-card">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLocation("/")}
            data-testid="button-back-to-app"
            className="gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to App
          </Button>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center">
              <Shield className="w-4 h-4 text-primary-foreground" />
            </div>
            <div>
              <p className="font-bold text-sm">NexusComm Admin</p>
              <p className="text-xs text-muted-foreground">Logged in as {user.displayName}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: "Total Users", value: stats?.totalUsers, icon: Users, color: "text-blue-500" },
            { label: "Channels", value: stats?.totalChannels, icon: Hash, color: "text-purple-500" },
            { label: "Online Now", value: stats?.onlineUsers, icon: Wifi, color: "text-green-500" },
            { label: "Messages", value: stats?.totalMessages, icon: MessageSquare, color: "text-orange-500" },
          ].map(({ label, value, icon: Icon, color }) => (
            <Card key={label} data-testid={`stat-${label.toLowerCase().replace(/\s+/g, "-")}`}>
              <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4 px-4">
                <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{label}</CardTitle>
                <Icon className={`w-4 h-4 ${color}`} />
              </CardHeader>
              <CardContent className="px-4 pb-4">
                <p className="text-3xl font-bold">
                  {statsLoading ? <span className="text-muted-foreground text-lg">—</span> : (value ?? 0)}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Tabs defaultValue="users">
          <TabsList>
            <TabsTrigger value="users" data-testid="tab-users">Users ({adminUsers.length})</TabsTrigger>
            <TabsTrigger value="channels" data-testid="tab-channels">Channels ({adminChannels.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="users" className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Manage all user accounts, roles, and passwords.</p>
              <Button
                size="sm"
                className="gap-2"
                onClick={() => setCreateUserOpen(true)}
                data-testid="button-create-user"
              >
                <UserPlus className="w-4 h-4" />
                New User
              </Button>
            </div>

            {usersLoading ? (
              <div className="flex items-center justify-center py-12">
                <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 border-b border-border">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">User</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Department</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Role</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden sm:table-cell">Status</th>
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {adminUsers.map(u => (
                      <tr key={u.id} className="hover:bg-muted/30 transition-colors" data-testid={`user-row-${u.id}`}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="relative">
                              <Avatar className="w-8 h-8">
                                <AvatarFallback className="text-xs bg-primary/10 text-primary font-semibold">
                                  {getInitials(u.displayName)}
                                </AvatarFallback>
                              </Avatar>
                              <span className={`absolute bottom-0 right-0 w-2 h-2 rounded-full border border-background ${STATUS_COLORS[u.status] || STATUS_COLORS.offline}`} />
                            </div>
                            <div className="min-w-0">
                              <p className="font-medium truncate">{u.displayName}</p>
                              <p className="text-xs text-muted-foreground truncate">@{u.username}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">
                          {u.department || <span className="italic text-muted-foreground/50">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className={`text-xs capitalize ${ROLE_COLORS[u.role] || ""}`}>
                            {u.role}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 hidden sm:table-cell">
                          <span className="flex items-center gap-1.5 text-muted-foreground capitalize">
                            <span className={`w-1.5 h-1.5 rounded-full ${STATUS_COLORS[u.status] || STATUS_COLORS.offline}`} />
                            {u.status}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8"
                              onClick={() => openEditUser(u)}
                              data-testid={`button-edit-user-${u.id}`}
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              onClick={() => setDeleteUserId(u.id)}
                              disabled={u.id === user.id}
                              data-testid={`button-delete-user-${u.id}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>

          <TabsContent value="channels" className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Create and manage communication channels.</p>
              <Button
                size="sm"
                className="gap-2"
                onClick={() => setCreateChannelOpen(true)}
                data-testid="button-create-channel-admin"
              >
                <Plus className="w-4 h-4" />
                New Channel
              </Button>
            </div>

            {channelsLoading ? (
              <div className="flex items-center justify-center py-12">
                <RefreshCw className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 border-b border-border">
                    <tr>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Channel</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground hidden md:table-cell">Description</th>
                      <th className="text-left px-4 py-3 font-medium text-muted-foreground">Members</th>
                      <th className="text-right px-4 py-3 font-medium text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {adminChannels.map(ch => (
                      <tr key={ch.id} className="hover:bg-muted/30 transition-colors" data-testid={`channel-row-${ch.id}`}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Hash className="w-4 h-4 text-muted-foreground shrink-0" />
                            <span className="font-medium">{ch.name}</span>
                            {ch.isPrivate && <Badge variant="outline" className="text-xs">Private</Badge>}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">
                          {ch.description || <span className="italic text-muted-foreground/50">No description</span>}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {ch.memberCount} member{ch.memberCount !== 1 ? "s" : ""}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              onClick={() => setDeleteChannelId(ch.id)}
                              data-testid={`button-delete-channel-${ch.id}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={!!editUser} onOpenChange={open => !open && setEditUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit User — {editUser?.displayName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Display Name</Label>
              <Input
                data-testid="input-edit-displayname"
                value={editForm.displayName}
                onChange={e => setEditForm(f => ({ ...f, displayName: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={editForm.role} onValueChange={v => setEditForm(f => ({ ...f, role: v }))}>
                <SelectTrigger data-testid="select-edit-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="manager">Manager</SelectItem>
                  <SelectItem value="employee">Employee</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Department</Label>
              <Input
                data-testid="input-edit-department"
                placeholder="e.g. Engineering"
                value={editForm.department}
                onChange={e => setEditForm(f => ({ ...f, department: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="flex items-center gap-2">
                <Key className="w-3.5 h-3.5" />
                New Password <span className="text-muted-foreground font-normal">(leave blank to keep current)</span>
              </Label>
              <Input
                data-testid="input-edit-password"
                type="password"
                placeholder="New password..."
                value={editForm.password}
                onChange={e => setEditForm(f => ({ ...f, password: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setEditUser(null)}>Cancel</Button>
            <Button
              data-testid="button-save-user"
              onClick={() => updateUserMutation.mutate({
                id: editUser!.id,
                body: {
                  displayName: editForm.displayName,
                  role: editForm.role,
                  department: editForm.department || null,
                  ...(editForm.password && { password: editForm.password }),
                },
              })}
              disabled={updateUserMutation.isPending}
            >
              {updateUserMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createUserOpen} onOpenChange={setCreateUserOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New User</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Username</Label>
              <Input
                data-testid="input-new-username"
                placeholder="e.g. john.smith"
                value={createUserForm.username}
                onChange={e => setCreateUserForm(f => ({ ...f, username: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Display Name</Label>
              <Input
                data-testid="input-new-displayname"
                placeholder="e.g. John Smith"
                value={createUserForm.displayName}
                onChange={e => setCreateUserForm(f => ({ ...f, displayName: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Password</Label>
              <Input
                data-testid="input-new-password"
                type="password"
                placeholder="Password"
                value={createUserForm.password}
                onChange={e => setCreateUserForm(f => ({ ...f, password: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={createUserForm.role} onValueChange={v => setCreateUserForm(f => ({ ...f, role: v }))}>
                <SelectTrigger data-testid="select-new-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="manager">Manager</SelectItem>
                  <SelectItem value="employee">Employee</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Department</Label>
              <Input
                data-testid="input-new-department"
                placeholder="e.g. Engineering"
                value={createUserForm.department}
                onChange={e => setCreateUserForm(f => ({ ...f, department: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setCreateUserOpen(false)}>Cancel</Button>
            <Button
              data-testid="button-submit-create-user"
              onClick={() => createUserMutation.mutate(createUserForm)}
              disabled={createUserMutation.isPending || !createUserForm.username || !createUserForm.password || !createUserForm.displayName}
            >
              {createUserMutation.isPending ? "Creating..." : "Create User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createChannelOpen} onOpenChange={setCreateChannelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Channel</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Channel Name</Label>
              <Input
                data-testid="input-new-channel-name"
                placeholder="e.g. announcements"
                value={createChannelForm.name}
                onChange={e => setCreateChannelForm(f => ({ ...f, name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Description (optional)</Label>
              <Input
                data-testid="input-new-channel-desc"
                placeholder="What's this channel about?"
                value={createChannelForm.description}
                onChange={e => setCreateChannelForm(f => ({ ...f, description: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setCreateChannelOpen(false)}>Cancel</Button>
            <Button
              data-testid="button-submit-create-channel"
              onClick={() => createChannelMutation.mutate(createChannelForm)}
              disabled={createChannelMutation.isPending || !createChannelForm.name.trim()}
            >
              {createChannelMutation.isPending ? "Creating..." : "Create Channel"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteUserId} onOpenChange={open => !open && setDeleteUserId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete User</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the user and all their messages. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => deleteUserId && deleteUserMutation.mutate(deleteUserId)}
              data-testid="button-confirm-delete-user"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteChannelId} onOpenChange={open => !open && setDeleteChannelId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Channel</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the channel and all its messages. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => deleteChannelId && deleteChannelMutation.mutate(deleteChannelId)}
              data-testid="button-confirm-delete-channel"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
