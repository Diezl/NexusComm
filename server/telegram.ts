import TelegramBot from "node-telegram-bot-api";

export type TgMessage = {
  id: number;
  chatId: number;
  chatTitle: string;
  chatType: string;
  text: string;
  fromName: string;
  fromUsername?: string;
  date: number;
  mediaType?: "photo" | "video" | "audio" | "document" | "sticker" | "voice";
  mediaFileId?: string;
  replyToText?: string;
};

export type TgChat = {
  id: number;
  title: string;
  type: string;
  username?: string;
  pinned: boolean;
  unread: number;
  lastMessage?: TgMessage;
};

const MAX_MESSAGES_PER_CHAT = 200;
const messageBuffer = new Map<number, TgMessage[]>();
const chatRegistry = new Map<number, TgChat>();
let broadcastFn: ((data: object) => void) | null = null;
let bot: TelegramBot | null = null;
let botInfo: { id: number; username: string; first_name: string } | null = null;
let botError: string | null = null;
let polling = false;

function getOrCreateChat(chatId: number, raw: any): TgChat {
  if (!chatRegistry.has(chatId)) {
    chatRegistry.set(chatId, {
      id: chatId,
      title: raw.title || raw.first_name || raw.username || String(chatId),
      type: raw.type || "unknown",
      username: raw.username,
      pinned: false,
      unread: 0,
    });
  }
  return chatRegistry.get(chatId)!;
}

function pushMessage(chatId: number, msg: TgMessage) {
  if (!messageBuffer.has(chatId)) messageBuffer.set(chatId, []);
  const buf = messageBuffer.get(chatId)!;
  buf.push(msg);
  if (buf.length > MAX_MESSAGES_PER_CHAT) buf.splice(0, buf.length - MAX_MESSAGES_PER_CHAT);
  const chat = chatRegistry.get(chatId);
  if (chat) {
    chat.lastMessage = msg;
    chat.unread++;
  }
}

function makeTgMessage(msg: TelegramBot.Message): TgMessage {
  const chatId = msg.chat.id;
  const fromName = msg.from
    ? [msg.from.first_name, msg.from.last_name].filter(Boolean).join(" ") || msg.from.username || "Unknown"
    : "Channel";

  let text = msg.text || msg.caption || "";
  let mediaType: TgMessage["mediaType"] | undefined;
  let mediaFileId: string | undefined;

  if (msg.photo) { mediaType = "photo"; mediaFileId = msg.photo[msg.photo.length - 1]?.file_id; text = text || "[Photo]"; }
  else if (msg.video) { mediaType = "video"; mediaFileId = msg.video.file_id; text = text || "[Video]"; }
  else if (msg.audio) { mediaType = "audio"; mediaFileId = msg.audio.file_id; text = text || `[Audio: ${msg.audio.title || msg.audio.file_name || ""}]`; }
  else if (msg.voice) { mediaType = "voice"; mediaFileId = msg.voice.file_id; text = text || "[Voice message]"; }
  else if (msg.document) { mediaType = "document"; mediaFileId = msg.document.file_id; text = text || `[File: ${msg.document.file_name || "document"}]`; }
  else if (msg.sticker) { mediaType = "sticker"; mediaFileId = msg.sticker.file_id; text = text || `[Sticker: ${msg.sticker.emoji || ""}]`; }

  let replyToText: string | undefined;
  if (msg.reply_to_message?.text) {
    replyToText = msg.reply_to_message.text.slice(0, 80) + (msg.reply_to_message.text.length > 80 ? "…" : "");
  }

  return {
    id: msg.message_id,
    chatId,
    chatTitle: msg.chat.title || msg.chat.first_name || String(chatId),
    chatType: msg.chat.type,
    text: text || "[Unsupported message type]",
    fromName,
    fromUsername: msg.from?.username,
    date: msg.date,
    mediaType,
    mediaFileId,
    replyToText,
  };
}

export function setBroadcast(fn: (data: object) => void) {
  broadcastFn = fn;
}

export async function initTelegramBot(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    botError = "TELEGRAM_BOT_TOKEN not configured. Add it in Secrets to enable the Telegram monitor.";
    console.warn("[telegram] No TELEGRAM_BOT_TOKEN set — bot disabled.");
    return;
  }

  try {
    bot = new TelegramBot(token, { polling: { interval: 1000, autoStart: false, params: { timeout: 10 } } });

    bot.on("message", (msg) => {
      const chatId = msg.chat.id;
      getOrCreateChat(chatId, msg.chat);
      const tgMsg = makeTgMessage(msg);
      pushMessage(chatId, tgMsg);
      broadcastFn?.({ type: "telegram_message", message: tgMsg });
      broadcastFn?.({ type: "telegram_chats", chats: getChats() });
    });

    bot.on("channel_post", (msg) => {
      const chatId = msg.chat.id;
      getOrCreateChat(chatId, msg.chat);
      const tgMsg = makeTgMessage(msg);
      pushMessage(chatId, tgMsg);
      broadcastFn?.({ type: "telegram_message", message: tgMsg });
      broadcastFn?.({ type: "telegram_chats", chats: getChats() });
    });

    bot.on("polling_error", (err: any) => {
      console.error("[telegram] Polling error:", err.message || err);
    });

    botInfo = await bot.getMe();
    await bot.startPolling();
    polling = true;
    botError = null;
    console.log(`[telegram] Bot @${botInfo.username} started polling.`);
  } catch (err: any) {
    botError = err.message || "Failed to start Telegram bot";
    console.error("[telegram] Init error:", botError);
    bot = null;
  }
}

export function getBotStatus() {
  return {
    configured: !!process.env.TELEGRAM_BOT_TOKEN,
    running: polling && !!bot,
    error: botError,
    bot: botInfo,
  };
}

export function getChats(): TgChat[] {
  return Array.from(chatRegistry.values()).sort((a, b) => {
    const aTime = a.lastMessage?.date ?? 0;
    const bTime = b.lastMessage?.date ?? 0;
    return bTime - aTime;
  });
}

export function getMessages(chatId: number): TgMessage[] {
  return messageBuffer.get(chatId) || [];
}

export function pinChat(chatId: number, pinned: boolean) {
  const chat = chatRegistry.get(chatId);
  if (chat) chat.pinned = pinned;
}

export function clearUnread(chatId: number) {
  const chat = chatRegistry.get(chatId);
  if (chat) chat.unread = 0;
}

export async function addChatById(idOrUsername: string): Promise<TgChat> {
  if (!bot) throw new Error("Bot not running");
  const chat = await bot.getChat(idOrUsername.startsWith("@") ? idOrUsername : Number(idOrUsername) || idOrUsername);
  const tgChat: TgChat = {
    id: chat.id,
    title: (chat as any).title || (chat as any).first_name || String(chat.id),
    type: chat.type,
    username: (chat as any).username,
    pinned: true,
    unread: 0,
  };
  chatRegistry.set(chat.id, tgChat);
  if (!messageBuffer.has(chat.id)) messageBuffer.set(chat.id, []);
  return tgChat;
}

export function stopBot() {
  if (bot && polling) {
    bot.stopPolling();
    polling = false;
  }
}
