import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { X, Download, Smartphone } from "lucide-react";
import { SiAndroid, SiApple } from "react-icons/si";
import { cn } from "@/lib/utils";

type Platform = "android" | "ios" | "desktop" | "unknown";

function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return "android";
  if (/iPad|iPhone|iPod/.test(ua)) return "ios";
  if (/Macintosh|Windows|Linux/.test(ua)) return "desktop";
  return "unknown";
}

function isInStandaloneMode(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as any).standalone === true
  );
}

const DISMISS_KEY = "nexuscomm-install-dismissed";

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [show, setShow] = useState(false);
  const [platform, setPlatform] = useState<Platform>("unknown");
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    // Don't show if already running as installed PWA
    if (isInStandaloneMode()) { setInstalled(true); return; }

    // Don't show if dismissed recently (within 7 days)
    const dismissed = localStorage.getItem(DISMISS_KEY);
    if (dismissed && Date.now() - parseInt(dismissed) < 7 * 24 * 60 * 60 * 1000) return;

    const p = detectPlatform();
    setPlatform(p);

    if (p === "android") {
      // Android: listen for browser's install prompt
      const handler = (e: Event) => {
        e.preventDefault();
        setDeferredPrompt(e);
        setShow(true);
      };
      window.addEventListener("beforeinstallprompt", handler as any);

      // Also show after a short delay if no prompt fires (some Android browsers)
      const timer = setTimeout(() => setShow(true), 4000);

      window.addEventListener("appinstalled", () => {
        setShow(false);
        setInstalled(true);
      });

      return () => {
        window.removeEventListener("beforeinstallprompt", handler as any);
        clearTimeout(timer);
      };
    }

    if (p === "ios") {
      // iOS: show manual instructions after a delay
      const timer = setTimeout(() => setShow(true), 3000);
      return () => clearTimeout(timer);
    }
  }, []);

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setShow(false);
  }

  async function install() {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === "accepted") {
        setInstalled(true);
        setShow(false);
      }
      setDeferredPrompt(null);
    }
    dismiss();
  }

  if (installed || !show) return null;

  return (
    <div
      className={cn(
        "fixed bottom-0 left-0 right-0 z-[9999] p-3",
        "flex justify-center",
        "safe-area-bottom"
      )}
      style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-border bg-card shadow-2xl overflow-hidden"
        data-testid="install-prompt"
      >
        <div className="flex items-start gap-3 p-4">
          <div className="shrink-0 w-12 h-12 rounded-xl bg-[#1a1f2e] flex items-center justify-center">
            <img src="/icons/icon-192.png" alt="NexusComm" className="w-10 h-10 rounded-lg" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-0.5">
              {platform === "android" ? (
                <SiAndroid className="w-3.5 h-3.5 text-[#3DDC84]" />
              ) : platform === "ios" ? (
                <SiApple className="w-3.5 h-3.5 text-foreground" />
              ) : (
                <Smartphone className="w-3.5 h-3.5 text-muted-foreground" />
              )}
              <p className="text-xs text-muted-foreground font-medium">Install App</p>
            </div>
            <p className="text-sm font-semibold leading-tight">NexusComm</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {platform === "ios"
                ? 'Tap Share → "Add to Home Screen"'
                : "Add to your home screen for the best experience"}
            </p>
          </div>
          <button
            onClick={dismiss}
            className="shrink-0 p-1 rounded-full hover:bg-muted text-muted-foreground"
            data-testid="button-dismiss-install"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {platform !== "ios" && (
          <div className="flex gap-2 px-4 pb-4">
            <Button
              variant="outline"
              size="sm"
              className="flex-1 h-9 text-xs"
              onClick={dismiss}
              data-testid="button-install-later"
            >
              Not now
            </Button>
            <Button
              size="sm"
              className="flex-1 h-9 text-xs bg-[#3DDC84] hover:bg-[#2ec874] text-black font-semibold"
              onClick={install}
              data-testid="button-install-now"
            >
              <Download className="w-3.5 h-3.5 mr-1.5" />
              Install
            </Button>
          </div>
        )}

        {platform === "ios" && (
          <div className="px-4 pb-4 flex justify-end">
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs px-4"
              onClick={dismiss}
              data-testid="button-install-got-it"
            >
              Got it
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
