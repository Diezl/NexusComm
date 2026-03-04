import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage, seedDatabase, verifyPassword } from "./storage";
import { uploadToDropbox, listDropboxFiles, getDropboxShareLink } from "./dropbox";
import { initTelegramBot, setBroadcast, getBotStatus, getChats, getMessages, pinChat, clearUnread, addChatById } from "./telegram";
import multer from "multer";
import path from "path";
import fs from "fs";
import { Client as SSHClient } from "ssh2";

const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename: (req, file, cb) => {
      const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      cb(null, `${unique}-${file.originalname}`);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
});

type WSClient = {
  ws: WebSocket;
  userId: string;
  username: string;
};

const clients = new Map<string, WSClient>();
const activeSections = new Map<string, string>();

function broadcast(data: object, excludeUserId?: string) {
  const msg = JSON.stringify(data);
  clients.forEach((client, userId) => {
    if (excludeUserId && userId === excludeUserId) return;
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(msg);
    }
  });
}

function sendTo(userId: string, data: object) {
  const client = clients.get(userId);
  if (client && client.ws.readyState === WebSocket.OPEN) {
    client.ws.send(JSON.stringify(data));
  }
}

function requireAuth(req: Request, res: Response, next: Function) {
  if (!req.session?.userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  next();
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  await seedDatabase();
  setBroadcast(broadcast);
  initTelegramBot().catch(console.error);

  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", (ws, req) => {
    let userId: string | null = null;

    ws.on("message", async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        if (msg.type === "auth") {
          userId = msg.userId;
          clients.set(userId, { ws, userId, username: msg.username });
          await storage.updateUserStatus(userId, "online");
          broadcast({ type: "user_status", userId, status: "online" });
          return;
        }

        if (!userId) return;

        if (msg.type === "message") {
          const message = await storage.createMessage({
            content: msg.content,
            channelId: msg.channelId || null,
            toUserId: msg.toUserId || null,
            fromUserId: userId,
            type: msg.messageType || "text",
            fileName: msg.fileName || null,
            fileUrl: msg.fileUrl || null,
            fileSize: msg.fileSize || null,
            mimeType: msg.mimeType || null,
          });
          const user = await storage.getUserById(userId);
          const enriched = {
            ...message,
            user: { id: user!.id, displayName: user!.displayName, avatar: user!.avatar, username: user!.username },
          };

          if (msg.channelId) {
            const members = await storage.getChannelMembers(msg.channelId);
            members.forEach(m => sendTo(m.id, { type: "message", message: enriched }));
          } else if (msg.toUserId) {
            sendTo(msg.toUserId, { type: "message", message: enriched });
            sendTo(userId, { type: "message", message: enriched });
          }
        }

        if (msg.type === "typing") {
          if (msg.channelId) {
            const members = await storage.getChannelMembers(msg.channelId);
            members.forEach(m => {
              if (m.id !== userId) sendTo(m.id, { type: "typing", userId, channelId: msg.channelId, isTyping: msg.isTyping });
            });
          } else if (msg.toUserId) {
            sendTo(msg.toUserId, { type: "typing", userId, isTyping: msg.isTyping });
          }
        }

        if (msg.type === "heartbeat") {
          const section = msg.section || null;
          const duration = Math.min(Math.max(0, msg.duration || 30), 300);
          if (section) activeSections.set(userId, section);
          await storage.logActivity(userId, "heartbeat", section, duration);
        }

        if (msg.type === "call_offer" || msg.type === "call_answer" || msg.type === "ice_candidate" || msg.type === "call_end" || msg.type === "call_reject" || msg.type === "call_initiate" || msg.type === "screen_share_start" || msg.type === "screen_share_end") {
          if (msg.targetUserId) {
            sendTo(msg.targetUserId, { ...msg, fromUserId: userId });
          }
        }
      } catch (e) {
        console.error("WS message error:", e);
      }
    });

    ws.on("close", async () => {
      if (userId) {
        clients.delete(userId);
        activeSections.delete(userId);
        await storage.updateUserStatus(userId, "offline");
        broadcast({ type: "user_status", userId, status: "offline" });
      }
    });
  });

  // SSH Terminal WebSocket server
  const sshWss = new WebSocketServer({ server: httpServer, path: "/ssh" });
  sshWss.on("connection", (ws) => {
    let sshClient: SSHClient | null = null;
    let stream: any = null;

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        if (msg.type === "connect") {
          sshClient = new SSHClient();

          sshClient.on("ready", () => {
            ws.send(JSON.stringify({ type: "status", status: "connected" }));
            sshClient!.shell({ term: "xterm-256color", cols: msg.cols || 80, rows: msg.rows || 24 }, (err, sh) => {
              if (err) {
                ws.send(JSON.stringify({ type: "error", message: err.message }));
                return;
              }
              stream = sh;
              stream.on("data", (data: Buffer) => {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({ type: "data", data: data.toString("base64") }));
                }
              });
              stream.stderr.on("data", (data: Buffer) => {
                if (ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({ type: "data", data: data.toString("base64") }));
                }
              });
              stream.on("close", () => {
                ws.send(JSON.stringify({ type: "status", status: "disconnected" }));
                sshClient?.end();
              });
            });
          });

          sshClient.on("error", (err) => {
            ws.send(JSON.stringify({ type: "error", message: err.message }));
          });

          const connectConfig: any = {
            host: msg.host,
            port: msg.port || 22,
            username: msg.username,
            readyTimeout: 15000,
          };
          if (msg.privateKey) {
            connectConfig.privateKey = msg.privateKey;
            if (msg.passphrase) connectConfig.passphrase = msg.passphrase;
          } else {
            connectConfig.password = msg.password;
          }
          sshClient.connect(connectConfig);
          return;
        }

        if (msg.type === "data" && stream) {
          stream.write(Buffer.from(msg.data, "base64"));
          return;
        }

        if (msg.type === "resize" && stream) {
          stream.setWindow(msg.rows, msg.cols, 0, 0);
          return;
        }

        if (msg.type === "disconnect") {
          stream?.close();
          sshClient?.end();
        }
      } catch (e) {
        console.error("SSH WS error:", e);
      }
    });

    ws.on("close", () => {
      stream?.close();
      sshClient?.end();
    });
  });

  app.post("/api/auth/register", async (req, res) => {
    const { username, password, displayName, role, department } = req.body;
    if (!username || !password || !displayName) {
      return res.status(400).json({ message: "Missing required fields" });
    }
    const existing = await storage.getUserByUsername(username);
    if (existing) return res.status(400).json({ message: "Username already taken" });
    const user = await storage.createUser({ username, password, displayName, role: role || "employee", department });
    const generalChannel = await storage.getChannelById("general").catch(() => null);
    const allChannels = await storage.getAllChannels();
    for (const ch of allChannels) {
      if (!ch.isPrivate) await storage.addChannelMember(ch.id, user.id);
    }
    req.session.userId = user.id;
    req.session.username = user.username;
    const { password: _, ...safeUser } = user;
    res.json(safeUser);
  });

  app.post("/api/auth/login", async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: "Missing credentials" });
    const user = await storage.getUserByUsername(username);
    if (!user || !verifyPassword(password, user.password)) {
      return res.status(401).json({ message: "Invalid credentials" });
    }
    req.session.userId = user.id;
    req.session.username = user.username;
    storage.logActivity(user.id, "login", null, 0).catch(() => {});
    const { password: _, ...safeUser } = user;
    res.json(safeUser);
  });

  app.post("/api/auth/logout", async (req, res) => {
    const userId = req.session.userId;
    if (userId) {
      await storage.updateUserStatus(userId, "offline");
      broadcast({ type: "user_status", userId, status: "offline" });
    }
    req.session.destroy(() => {});
    res.json({ ok: true });
  });

  app.get("/api/auth/me", async (req, res) => {
    if (!req.session?.userId) return res.status(401).json({ message: "Unauthorized" });
    const user = await storage.getUserById(req.session.userId);
    if (!user) return res.status(401).json({ message: "User not found" });
    const { password: _, ...safeUser } = user;
    res.json(safeUser);
  });

  app.get("/api/users", requireAuth, async (req, res) => {
    const allUsers = await storage.getAllUsers();
    res.json(allUsers);
  });

  app.patch("/api/users/me/status", requireAuth, async (req, res) => {
    const { status } = req.body;
    if (!["online", "away", "busy", "offline"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }
    await storage.updateUserStatus(req.session.userId!, status);
    broadcast({ type: "user_status", userId: req.session.userId, status });
    res.json({ ok: true });
  });

  app.patch("/api/users/me", requireAuth, async (req, res) => {
    const { displayName, avatar, department, role } = req.body;
    const user = await storage.updateUser(req.session.userId!, { displayName, avatar, department, role });
    const { password: _, ...safeUser } = user;
    res.json(safeUser);
  });

  app.get("/api/channels", requireAuth, async (req, res) => {
    const myChannels = await storage.getUserChannels(req.session.userId!);
    res.json(myChannels);
  });

  app.get("/api/channels/all", requireAuth, async (req, res) => {
    const all = await storage.getAllChannels();
    res.json(all);
  });

  app.post("/api/channels", requireAuth, async (req, res) => {
    const { name, description, isPrivate } = req.body;
    if (!name) return res.status(400).json({ message: "Channel name required" });
    const channel = await storage.createChannel({
      name: name.toLowerCase().replace(/\s+/g, "-"),
      description,
      isPrivate: isPrivate || false,
      createdBy: req.session.userId!,
    });
    await storage.addChannelMember(channel.id, req.session.userId!);
    res.json(channel);
  });

  app.post("/api/channels/:id/join", requireAuth, async (req, res) => {
    await storage.addChannelMember(req.params.id, req.session.userId!);
    res.json({ ok: true });
  });

  app.post("/api/channels/:id/leave", requireAuth, async (req, res) => {
    await storage.removeChannelMember(req.params.id, req.session.userId!);
    res.json({ ok: true });
  });

  app.get("/api/channels/:id/members", requireAuth, async (req, res) => {
    const members = await storage.getChannelMembers(req.params.id);
    res.json(members);
  });

  app.get("/api/messages/channel/:channelId", requireAuth, async (req, res) => {
    const msgs = await storage.getChannelMessages(req.params.channelId);
    res.json(msgs);
  });

  app.get("/api/messages/dm/:userId", requireAuth, async (req, res) => {
    const msgs = await storage.getDirectMessages(req.session.userId!, req.params.userId);
    res.json(msgs);
  });

  app.post("/api/messages/share-link", requireAuth, async (req, res) => {
    const { channelId, toUserId, fileUrl, fileName, mimeType } = req.body;
    if (!fileUrl) return res.status(400).json({ message: "fileUrl required" });
    if (!channelId && !toUserId) return res.status(400).json({ message: "channelId or toUserId required" });
    const message = await storage.createMessage({
      content: "",
      channelId: channelId || null,
      toUserId: toUserId || null,
      fromUserId: req.session.userId!,
      type: "file",
      fileName: fileName || null,
      fileUrl,
      fileSize: null,
      mimeType: mimeType || null,
    });
    const user = await storage.getUserById(req.session.userId!);
    const enriched = {
      ...message,
      user: { id: user!.id, displayName: user!.displayName, avatar: user!.avatar, username: user!.username },
    };
    if (channelId) {
      const members = await storage.getChannelMembers(channelId);
      members.forEach(m => sendTo(m.id, { type: "message", message: enriched }));
    } else if (toUserId) {
      sendTo(toUserId, { type: "message", message: enriched });
      sendTo(req.session.userId!, { type: "message", message: enriched });
    }
    res.json(enriched);
  });

  app.post("/api/upload", requireAuth, upload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    const fileUrl = `/uploads/${req.file.filename}`;
    res.json({
      fileUrl,
      fileName: req.file.originalname,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
    });
  });

  // Dropbox integration routes
  app.post("/api/dropbox/upload", requireAuth, upload.single("file"), async (req, res) => {
    if (!req.file) return res.status(400).json({ message: "No file uploaded" });
    try {
      const fileBuffer = fs.readFileSync(req.file.path);
      const folder = (req.body.folder as string) || '';
      const result = await uploadToDropbox(fileBuffer, req.file.originalname, req.file.mimetype, folder);
      fs.unlinkSync(req.file.path);
      res.json({
        fileUrl: result.shareUrl,
        dropboxPath: result.dropboxPath,
        fileName: result.fileName,
        fileSize: result.size,
        mimeType: req.file.mimetype,
        storage: "dropbox",
      });
    } catch (err: any) {
      console.error("Dropbox upload error:", err);
      res.status(500).json({ message: err.message || "Dropbox upload failed" });
    }
  });

  app.get("/api/dropbox/files", requireAuth, async (req, res) => {
    try {
      const folder = (req.query.folder as string) ?? '';
      const files = await listDropboxFiles(folder);
      res.json(files);
    } catch (err: any) {
      console.error("Dropbox list error:", err);
      res.status(500).json({ message: err.message || "Failed to list Dropbox files" });
    }
  });

  app.post("/api/dropbox/share", requireAuth, async (req, res) => {
    const { path: dropboxPath } = req.body;
    if (!dropboxPath) return res.status(400).json({ message: "Path required" });
    try {
      const url = await getDropboxShareLink(dropboxPath);
      res.json({ url });
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to get share link" });
    }
  });

  // Telegram Monitor routes
  app.get("/api/telegram/status", requireAuth, (req, res) => {
    res.json(getBotStatus());
  });

  app.get("/api/telegram/chats", requireAuth, (req, res) => {
    res.json(getChats());
  });

  app.get("/api/telegram/messages/:chatId", requireAuth, (req, res) => {
    const chatId = parseInt(req.params.chatId);
    if (isNaN(chatId)) return res.status(400).json({ message: "Invalid chat ID" });
    clearUnread(chatId);
    res.json(getMessages(chatId));
  });

  app.post("/api/telegram/chats/add", requireAuth, async (req, res) => {
    const { id } = req.body;
    if (!id) return res.status(400).json({ message: "id required" });
    try {
      const chat = await addChatById(String(id));
      res.json(chat);
    } catch (err: any) {
      res.status(500).json({ message: err.message || "Failed to add chat" });
    }
  });

  app.patch("/api/telegram/chats/:chatId/pin", requireAuth, (req, res) => {
    const chatId = parseInt(req.params.chatId);
    const { pinned } = req.body;
    pinChat(chatId, !!pinned);
    res.json({ ok: true });
  });

  async function requireAdmin(req: Request, res: Response, next: Function) {
    if (!req.session?.userId) return res.status(401).json({ message: "Unauthorized" });
    const user = await storage.getUserById(req.session.userId);
    if (!user || user.role !== "admin") return res.status(403).json({ message: "Forbidden: admin only" });
    next();
  }

  app.get("/api/admin/stats", requireAdmin, async (_req, res) => {
    const stats = await storage.getAdminStats();
    res.json(stats);
  });

  app.get("/api/admin/users", requireAdmin, async (_req, res) => {
    const allUsers = await storage.getAllUsers();
    res.json(allUsers);
  });

  app.post("/api/admin/users", requireAdmin, async (req, res) => {
    const { username, password, displayName, role, department } = req.body;
    if (!username || !password || !displayName) {
      return res.status(400).json({ message: "username, password, and displayName are required" });
    }
    const existing = await storage.getUserByUsername(username);
    if (existing) return res.status(409).json({ message: "Username already taken" });
    const user = await storage.createUser({ username, password, displayName, role: role || "employee", department: department || null, avatar: null });
    const allChannels = await storage.getAllChannels();
    for (const ch of allChannels) {
      await storage.addChannelMember(ch.id, user.id);
    }
    const { password: _, ...safeUser } = user;
    res.status(201).json(safeUser);
  });

  app.patch("/api/admin/users/:id", requireAdmin, async (req, res) => {
    const { displayName, role, department, password } = req.body;
    const user = await storage.getUserById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    if (password) {
      await storage.resetUserPassword(req.params.id, password);
    }
    const updated = await storage.updateUser(req.params.id, {
      ...(displayName !== undefined && { displayName }),
      ...(role !== undefined && { role }),
      ...(department !== undefined && { department }),
    });
    const { password: _, ...safeUser } = updated;
    res.json(safeUser);
  });

  app.delete("/api/admin/users/:id", requireAdmin, async (req, res) => {
    if (req.params.id === req.session.userId) {
      return res.status(400).json({ message: "Cannot delete your own account" });
    }
    const user = await storage.getUserById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    await storage.deleteUser(req.params.id);
    res.json({ ok: true });
  });

  app.get("/api/admin/channels", requireAdmin, async (_req, res) => {
    const allChannels = await storage.getAllChannels();
    res.json(allChannels);
  });

  app.post("/api/admin/channels", requireAdmin, async (req, res) => {
    const { name, description, isPrivate } = req.body;
    if (!name) return res.status(400).json({ message: "name is required" });
    const channel = await storage.createChannel({ name: name.toLowerCase().replace(/\s+/g, "-"), description: description || null, isPrivate: !!isPrivate, createdBy: req.session.userId! });
    const allUsers = await storage.getAllUsers();
    for (const u of allUsers) {
      await storage.addChannelMember(channel.id, u.id);
    }
    res.status(201).json(channel);
  });

  app.delete("/api/admin/channels/:id", requireAdmin, async (req, res) => {
    const channel = await storage.getChannelById(req.params.id);
    if (!channel) return res.status(404).json({ message: "Channel not found" });
    await storage.deleteChannel(req.params.id);
    res.json({ ok: true });
  });

  app.post("/api/activity/heartbeat", requireAuth, async (req, res) => {
    const userId = req.session.userId!;
    const { section, duration } = req.body;
    const dur = Math.min(Math.max(0, duration || 30), 300);
    if (section) activeSections.set(userId, section);
    await storage.logActivity(userId, "heartbeat", section || null, dur);
    res.json({ ok: true });
  });

  app.get("/api/admin/activity", requireAdmin, async (_req, res) => {
    const summary = await storage.getActivitySummary();
    summary.forEach(s => {
      s.currentSection = activeSections.get(s.userId) || null;
    });
    res.json(summary);
  });

  app.get("/api/admin/activity/:userId", requireAdmin, async (req, res) => {
    const logs = await storage.getUserActivityLogs(req.params.userId, 200);
    res.json(logs);
  });

  return httpServer;
}
