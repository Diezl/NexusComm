import { useEffect, useRef } from "react";

const HEARTBEAT_INTERVAL = 30000;

export function useActivityTracker(
  section: string | null,
  send: ((data: object) => void) | null,
  enabled: boolean = true
) {
  const lastSendTime = useRef<number>(Date.now());
  const sectionRef = useRef<string | null>(section);

  const sendHeartbeat = (sec: string, duration: number) => {
    if (send) {
      send({ type: "heartbeat", section: sec, duration });
    } else {
      fetch("/api/activity/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section: sec, duration }),
        credentials: "include",
      }).catch(() => {});
    }
  };

  useEffect(() => {
    if (!enabled || !section) return;

    if (sectionRef.current !== section) {
      const elapsed = Math.round((Date.now() - lastSendTime.current) / 1000);
      if (elapsed > 2 && sectionRef.current) {
        sendHeartbeat(sectionRef.current, elapsed);
      }
      sectionRef.current = section;
      lastSendTime.current = Date.now();
    }
  }, [section]);

  useEffect(() => {
    if (!enabled || !section) return;

    sectionRef.current = section;
    lastSendTime.current = Date.now();

    const interval = setInterval(() => {
      const now = Date.now();
      const elapsed = Math.round((now - lastSendTime.current) / 1000);
      lastSendTime.current = now;
      if (elapsed > 0 && sectionRef.current) {
        sendHeartbeat(sectionRef.current, elapsed);
      }
    }, HEARTBEAT_INTERVAL);

    return () => {
      clearInterval(interval);
      const elapsed = Math.round((Date.now() - lastSendTime.current) / 1000);
      if (elapsed > 2 && sectionRef.current) {
        sendHeartbeat(sectionRef.current, elapsed);
      }
    };
  }, [enabled, send]);
}
