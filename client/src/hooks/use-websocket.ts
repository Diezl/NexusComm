import { useEffect, useRef, useCallback } from "react";
import type { UserPublic, MessageWithUser } from "@shared/schema";

type WSMessage = {
  type: string;
  [key: string]: any;
};

type WSHandlers = {
  onMessage?: (msg: MessageWithUser) => void;
  onUserStatus?: (userId: string, status: string) => void;
  onTyping?: (userId: string, channelId?: string, isTyping?: boolean) => void;
  onCallInitiate?: (data: any) => void;
  onCallOffer?: (data: any) => void;
  onCallAnswer?: (data: any) => void;
  onIceCandidate?: (data: any) => void;
  onCallEnd?: (data: any) => void;
  onCallReject?: (data: any) => void;
  onScreenShareStart?: (data: any) => void;
  onScreenShareEnd?: (data: any) => void;
  onTelegramMessage?: (msg: any) => void;
  onTelegramChats?: (chats: any[]) => void;
};

export function useWebSocket(user: UserPublic | null, handlers: WSHandlers) {
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!user) return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "auth", userId: user.id, username: user.username }));
    };

    ws.onmessage = (event) => {
      try {
        const data: WSMessage = JSON.parse(event.data);
        const h = handlersRef.current;
        switch (data.type) {
          case "message": h.onMessage?.(data.message); break;
          case "user_status": h.onUserStatus?.(data.userId, data.status); break;
          case "typing": h.onTyping?.(data.userId, data.channelId, data.isTyping); break;
          case "call_initiate": h.onCallInitiate?.(data); break;
          case "call_offer": h.onCallOffer?.(data); break;
          case "call_answer": h.onCallAnswer?.(data); break;
          case "ice_candidate": h.onIceCandidate?.(data); break;
          case "call_end": h.onCallEnd?.(data); break;
          case "call_reject": h.onCallReject?.(data); break;
          case "screen_share_start": h.onScreenShareStart?.(data); break;
          case "screen_share_end": h.onScreenShareEnd?.(data); break;
          case "telegram_message": h.onTelegramMessage?.(data.message); break;
          case "telegram_chats": h.onTelegramChats?.(data.chats); break;
        }
      } catch (e) {
        console.error("WS parse error:", e);
      }
    };

    ws.onclose = () => { wsRef.current = null; };

    return () => { ws.close(); };
  }, [user?.id]);

  const send = useCallback((data: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  return { send };
}
