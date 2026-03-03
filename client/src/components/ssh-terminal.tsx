import { useState, useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Terminal as TerminalIcon, Wifi, WifiOff, X, Plus, Key, Lock } from "lucide-react";
import "@xterm/xterm/css/xterm.css";

type AuthMethod = "password" | "privateKey";

type SSHSession = {
  id: string;
  label: string;
  host: string;
  port: number;
  username: string;
  status: "connecting" | "connected" | "disconnected" | "error";
  errorMessage?: string;
};

type ConnectForm = {
  host: string;
  port: string;
  username: string;
  authMethod: AuthMethod;
  password: string;
  privateKey: string;
  passphrase: string;
  label: string;
};

const DEFAULT_FORM: ConnectForm = {
  host: "",
  port: "22",
  username: "",
  authMethod: "password",
  password: "",
  privateKey: "",
  passphrase: "",
  label: "",
};

function TerminalPane({ session, onDisconnect }: { session: SSHSession; onDisconnect: () => void }) {
  const termRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState(session.status);
  const [errorMsg, setErrorMsg] = useState(session.errorMessage || "");

  const connectWS = useCallback((sess: SSHSession, form: any) => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ssh`);
    wsRef.current = ws;

    ws.onopen = () => {
      const cols = terminalRef.current?.cols || 80;
      const rows = terminalRef.current?.rows || 24;
      ws.send(JSON.stringify({
        type: "connect",
        host: form.host,
        port: parseInt(form.port) || 22,
        username: form.username,
        password: form.authMethod === "password" ? form.password : undefined,
        privateKey: form.authMethod === "privateKey" ? form.privateKey : undefined,
        passphrase: form.passphrase || undefined,
        cols,
        rows,
      }));
    };

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "data") {
        terminalRef.current?.write(Buffer.from(msg.data, "base64"));
      } else if (msg.type === "status") {
        setStatus(msg.status);
        if (msg.status === "disconnected") onDisconnect();
      } else if (msg.type === "error") {
        setStatus("error");
        setErrorMsg(msg.message);
        terminalRef.current?.writeln(`\r\n\x1b[31mError: ${msg.message}\x1b[0m`);
      }
    };

    ws.onclose = () => {
      setStatus("disconnected");
    };
  }, [onDisconnect]);

  useEffect(() => {
    if (!termRef.current) return;

    const term = new Terminal({
      theme: {
        background: "#0d1117",
        foreground: "#c9d1d9",
        cursor: "#58a6ff",
        selectionBackground: "#264f78",
        black: "#484f58",
        red: "#ff7b72",
        green: "#3fb950",
        yellow: "#d29922",
        blue: "#58a6ff",
        magenta: "#bc8cff",
        cyan: "#39c5cf",
        white: "#b1bac4",
        brightBlack: "#6e7681",
        brightRed: "#ffa198",
        brightGreen: "#56d364",
        brightYellow: "#e3b341",
        brightBlue: "#79c0ff",
        brightMagenta: "#d2a8ff",
        brightCyan: "#56d4dd",
        brightWhite: "#f0f6fc",
      },
      fontFamily: '"Cascadia Code", "Fira Code", "JetBrains Mono", "Courier New", monospace',
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: "block",
      scrollback: 5000,
      allowTransparency: false,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(termRef.current);
    fitAddon.fit();

    terminalRef.current = term;
    fitAddonRef.current = fitAddon;

    term.onData((data) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({
          type: "data",
          data: Buffer.from(data).toString("base64"),
        }));
      }
    });

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      if (wsRef.current?.readyState === WebSocket.OPEN && terminalRef.current) {
        wsRef.current.send(JSON.stringify({
          type: "resize",
          cols: terminalRef.current.cols,
          rows: terminalRef.current.rows,
        }));
      }
    });
    if (termRef.current) resizeObserver.observe(termRef.current);

    const storedForm = sessionStorage.getItem(`ssh-form-${session.id}`);
    if (storedForm) {
      connectWS(session, JSON.parse(storedForm));
    }

    return () => {
      resizeObserver.disconnect();
      term.dispose();
      wsRef.current?.close();
    };
  }, []);

  const handleDisconnect = () => {
    wsRef.current?.send(JSON.stringify({ type: "disconnect" }));
    wsRef.current?.close();
    onDisconnect();
  };

  const statusColor = status === "connected" ? "bg-green-500" : status === "error" ? "bg-red-500" : "bg-yellow-500";

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-card shrink-0">
        <span className={`w-2 h-2 rounded-full ${statusColor}`} />
        <span className="text-sm font-medium text-foreground">{session.username}@{session.host}:{session.port}</span>
        <Badge variant="outline" className="text-xs ml-1">
          {status === "connected" ? <Wifi className="w-3 h-3 mr-1 text-green-500" /> : <WifiOff className="w-3 h-3 mr-1 text-muted-foreground" />}
          {status}
        </Badge>
        {errorMsg && <span className="text-xs text-destructive ml-2">{errorMsg}</span>}
        <div className="ml-auto">
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-destructive" onClick={handleDisconnect} data-testid="button-ssh-disconnect">
            <X className="w-3 h-3 mr-1" /> Disconnect
          </Button>
        </div>
      </div>
      <div ref={termRef} className="flex-1 overflow-hidden p-1" data-testid="ssh-terminal-canvas" />
    </div>
  );
}

export function SSHTerminal() {
  const { toast } = useToast();
  const [sessions, setSessions] = useState<SSHSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [form, setForm] = useState<ConnectForm>(DEFAULT_FORM);
  const [isConnecting, setIsConnecting] = useState(false);
  const [showNewForm, setShowNewForm] = useState(true);

  const handleConnect = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.host || !form.username) {
      toast({ title: "Host and username are required", variant: "destructive" });
      return;
    }

    const id = `ssh-${Date.now()}`;
    const label = form.label || `${form.username}@${form.host}`;
    const newSession: SSHSession = {
      id,
      label,
      host: form.host,
      port: parseInt(form.port) || 22,
      username: form.username,
      status: "connecting",
    };

    sessionStorage.setItem(`ssh-form-${id}`, JSON.stringify(form));
    setSessions(prev => [...prev, newSession]);
    setActiveSessionId(id);
    setShowNewForm(false);
    setIsConnecting(false);
    setForm(DEFAULT_FORM);
  };

  const removeSession = (id: string) => {
    setSessions(prev => prev.filter(s => s.id !== id));
    sessionStorage.removeItem(`ssh-form-${id}`);
    if (activeSessionId === id) {
      const remaining = sessions.filter(s => s.id !== id);
      setActiveSessionId(remaining.length > 0 ? remaining[remaining.length - 1].id : null);
      if (remaining.length === 0) setShowNewForm(true);
    }
  };

  const activeSession = sessions.find(s => s.id === activeSessionId);

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border bg-card shrink-0">
        <TerminalIcon className="w-4 h-4 text-primary" />
        <h2 className="font-semibold text-sm">SSH Terminal</h2>
        <div className="ml-auto flex items-center gap-2">
          {sessions.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => { setShowNewForm(true); setActiveSessionId(null); }}
              data-testid="button-new-ssh-session"
            >
              <Plus className="w-3.5 h-3.5 mr-1.5" />
              New Session
            </Button>
          )}
        </div>
      </div>

      {/* Session tabs */}
      {sessions.length > 0 && (
        <div className="flex items-center gap-1 px-3 py-1 border-b border-border bg-card/50 shrink-0 overflow-x-auto">
          {sessions.map(sess => (
            <button
              key={sess.id}
              data-testid={`ssh-tab-${sess.id}`}
              onClick={() => { setActiveSessionId(sess.id); setShowNewForm(false); }}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors shrink-0 ${activeSessionId === sess.id && !showNewForm ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${sess.status === "connected" ? "bg-green-400" : sess.status === "error" ? "bg-red-400" : "bg-yellow-400"}`} />
              {sess.label}
              <X className="w-3 h-3 ml-1 opacity-60 hover:opacity-100" onClick={(e) => { e.stopPropagation(); removeSession(sess.id); }} />
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {showNewForm || sessions.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-full max-w-md px-6 py-8 space-y-6">
              <div className="text-center space-y-1">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center mx-auto mb-3">
                  <TerminalIcon className="w-6 h-6 text-primary" />
                </div>
                <h3 className="font-semibold text-lg">New SSH Connection</h3>
                <p className="text-sm text-muted-foreground">Connect to a remote server via SSH</p>
              </div>

              <form onSubmit={handleConnect} className="space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2 space-y-1.5">
                    <Label htmlFor="ssh-host">Host / IP Address</Label>
                    <Input
                      id="ssh-host"
                      data-testid="input-ssh-host"
                      placeholder="192.168.1.1"
                      value={form.host}
                      onChange={e => setForm(f => ({ ...f, host: e.target.value }))}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ssh-port">Port</Label>
                    <Input
                      id="ssh-port"
                      data-testid="input-ssh-port"
                      placeholder="22"
                      value={form.port}
                      onChange={e => setForm(f => ({ ...f, port: e.target.value }))}
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="ssh-username">Username</Label>
                  <Input
                    id="ssh-username"
                    data-testid="input-ssh-username"
                    placeholder="root"
                    value={form.username}
                    onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="ssh-label">Label (optional)</Label>
                  <Input
                    id="ssh-label"
                    data-testid="input-ssh-label"
                    placeholder="My Server"
                    value={form.label}
                    onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                  />
                </div>

                <Tabs value={form.authMethod} onValueChange={v => setForm(f => ({ ...f, authMethod: v as AuthMethod }))}>
                  <TabsList className="w-full">
                    <TabsTrigger value="password" className="flex-1" data-testid="tab-ssh-password">
                      <Lock className="w-3.5 h-3.5 mr-1.5" />
                      Password
                    </TabsTrigger>
                    <TabsTrigger value="privateKey" className="flex-1" data-testid="tab-ssh-key">
                      <Key className="w-3.5 h-3.5 mr-1.5" />
                      Private Key
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="password" className="mt-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="ssh-password">Password</Label>
                      <Input
                        id="ssh-password"
                        data-testid="input-ssh-password"
                        type="password"
                        placeholder="••••••••"
                        value={form.password}
                        onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                      />
                    </div>
                  </TabsContent>
                  <TabsContent value="privateKey" className="mt-3 space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="ssh-key">Private Key (PEM format)</Label>
                      <Textarea
                        id="ssh-key"
                        data-testid="input-ssh-private-key"
                        placeholder="-----BEGIN RSA PRIVATE KEY-----&#10;..."
                        className="font-mono text-xs h-28 resize-none"
                        value={form.privateKey}
                        onChange={e => setForm(f => ({ ...f, privateKey: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="ssh-passphrase">Passphrase (if encrypted)</Label>
                      <Input
                        id="ssh-passphrase"
                        data-testid="input-ssh-passphrase"
                        type="password"
                        placeholder="Optional"
                        value={form.passphrase}
                        onChange={e => setForm(f => ({ ...f, passphrase: e.target.value }))}
                      />
                    </div>
                  </TabsContent>
                </Tabs>

                <Button
                  type="submit"
                  className="w-full"
                  disabled={isConnecting}
                  data-testid="button-ssh-connect"
                >
                  <TerminalIcon className="w-4 h-4 mr-2" />
                  {isConnecting ? "Connecting..." : "Connect"}
                </Button>
              </form>
            </div>
          </div>
        ) : activeSession ? (
          <TerminalPane
            key={activeSession.id}
            session={activeSession}
            onDisconnect={() => removeSession(activeSession.id)}
          />
        ) : null}
      </div>
    </div>
  );
}
