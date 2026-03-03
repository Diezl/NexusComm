import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Shield, MessageSquare, Video, Users, Lock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function LoginPage() {
  const { login, register } = useAuth();
  const { toast } = useToast();
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [registerForm, setRegisterForm] = useState({ username: "", password: "", displayName: "", department: "" });

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    try {
      await login.mutateAsync(loginForm);
    } catch {
      toast({ title: "Login failed", description: "Invalid username or password", variant: "destructive" });
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    try {
      await register.mutateAsync(registerForm);
    } catch (err: any) {
      toast({ title: "Registration failed", description: err?.message || "Try a different username", variant: "destructive" });
    }
  }

  return (
    <div className="min-h-screen bg-background flex">
      <div className="hidden lg:flex w-1/2 bg-sidebar flex-col justify-center items-center p-12 border-r border-sidebar-border">
        <div className="max-w-md w-full space-y-10">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-md bg-primary flex items-center justify-center">
              <Shield className="w-6 h-6 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-sidebar-foreground tracking-tight">NexusComm</h1>
              <p className="text-xs text-muted-foreground">Private Enterprise Platform</p>
            </div>
          </div>
          <div className="space-y-6">
            {[
              { icon: MessageSquare, title: "Encrypted Messaging", desc: "Private channels and direct messages for your team" },
              { icon: Video, title: "HD Video Calling", desc: "Crystal-clear audio and video calls with screen sharing" },
              { icon: Users, title: "Employee Directory", desc: "Track presence, availability, and team activity" },
              { icon: Lock, title: "Enterprise Security", desc: "Secure file sharing and access controls" },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="flex gap-4 items-start">
                <div className="w-9 h-9 rounded-md bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                  <Icon className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="font-semibold text-sidebar-foreground text-sm">{title}</p>
                  <p className="text-muted-foreground text-sm">{desc}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="pt-6 border-t border-sidebar-border">
            <p className="text-xs text-muted-foreground">
              Demo credentials: <span className="font-mono text-foreground">admin</span> / <span className="font-mono text-foreground">password123</span>
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">
          <div className="flex items-center gap-3 lg:hidden mb-8 justify-center">
            <div className="w-10 h-10 rounded-md bg-primary flex items-center justify-center">
              <Shield className="w-6 h-6 text-primary-foreground" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">NexusComm</h1>
          </div>

          <Tabs defaultValue="login" className="w-full">
            <TabsList className="w-full mb-6">
              <TabsTrigger value="login" className="flex-1" data-testid="tab-login">Sign In</TabsTrigger>
              <TabsTrigger value="register" className="flex-1" data-testid="tab-register">Create Account</TabsTrigger>
            </TabsList>

            <TabsContent value="login">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Welcome back</CardTitle>
                  <CardDescription>Sign in to your workspace</CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleLogin} className="space-y-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="login-username">Username</Label>
                      <Input
                        id="login-username"
                        data-testid="input-username"
                        placeholder="your.username"
                        value={loginForm.username}
                        onChange={e => setLoginForm(f => ({ ...f, username: e.target.value }))}
                        required
                        autoComplete="username"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="login-password">Password</Label>
                      <Input
                        id="login-password"
                        data-testid="input-password"
                        type="password"
                        placeholder="••••••••"
                        value={loginForm.password}
                        onChange={e => setLoginForm(f => ({ ...f, password: e.target.value }))}
                        required
                        autoComplete="current-password"
                      />
                    </div>
                    <Button type="submit" className="w-full" data-testid="button-login" disabled={login.isPending}>
                      {login.isPending ? "Signing in..." : "Sign In"}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="register">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Create account</CardTitle>
                  <CardDescription>Join your company workspace</CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleRegister} className="space-y-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="reg-name">Full Name</Label>
                      <Input
                        id="reg-name"
                        data-testid="input-displayname"
                        placeholder="Jane Smith"
                        value={registerForm.displayName}
                        onChange={e => setRegisterForm(f => ({ ...f, displayName: e.target.value }))}
                        required
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="reg-username">Username</Label>
                      <Input
                        id="reg-username"
                        data-testid="input-reg-username"
                        placeholder="jane.smith"
                        value={registerForm.username}
                        onChange={e => setRegisterForm(f => ({ ...f, username: e.target.value }))}
                        required
                        autoComplete="username"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="reg-dept">Department</Label>
                      <Input
                        id="reg-dept"
                        data-testid="input-department"
                        placeholder="Engineering"
                        value={registerForm.department}
                        onChange={e => setRegisterForm(f => ({ ...f, department: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="reg-password">Password</Label>
                      <Input
                        id="reg-password"
                        data-testid="input-reg-password"
                        type="password"
                        placeholder="••••••••"
                        value={registerForm.password}
                        onChange={e => setRegisterForm(f => ({ ...f, password: e.target.value }))}
                        required
                        autoComplete="new-password"
                      />
                    </div>
                    <Button type="submit" className="w-full" data-testid="button-register" disabled={register.isPending}>
                      {register.isPending ? "Creating..." : "Create Account"}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
