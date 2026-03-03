import { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Phone, PhoneOff, Mic, MicOff, Video, VideoOff,
  Monitor, MonitorOff, Volume2, VolumeX, Maximize2
} from "lucide-react";
import type { UserPublic } from "@shared/schema";

type CallState = {
  callId?: string;
  type: "audio" | "video";
  direction: "incoming" | "outgoing";
  status: "ringing" | "connected" | "ended";
  remoteUser: UserPublic;
  isScreenSharing?: boolean;
};

type Props = {
  callState: CallState | null;
  send: (data: object) => void;
  currentUser: UserPublic;
  onCallEnd: () => void;
  incomingCallData?: any;
};

export function CallOverlay({ callState, send, currentUser, onCallEnd, incomingCallData }: Props) {
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);

  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isSpeakerOff, setIsSpeakerOff] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const getInitials = (name: string) =>
    name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();

  const createPC = useCallback(() => {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ],
    });
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        send({ type: "ice_candidate", targetUserId: callState?.remoteUser.id, candidate: e.candidate });
      }
    };
    pc.ontrack = (e) => {
      if (remoteVideoRef.current && e.streams[0]) {
        remoteVideoRef.current.srcObject = e.streams[0];
      }
    };
    return pc;
  }, [callState?.remoteUser.id, send]);

  useEffect(() => {
    if (!callState || callState.status === "ended") return;
    let mounted = true;

    async function setupCall() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: callState!.type === "video",
          audio: true,
        });
        if (!mounted) { stream.getTracks().forEach(t => t.stop()); return; }
        localStreamRef.current = stream;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;

        const pc = createPC();
        pcRef.current = pc;
        stream.getTracks().forEach(track => pc.addTrack(track, stream));

        if (callState!.direction === "outgoing") {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          send({ type: "call_offer", targetUserId: callState!.remoteUser.id, offer, callType: callState!.type });
        }
      } catch (e) {
        console.error("Media error:", e);
      }
    }

    setupCall();

    return () => {
      mounted = false;
    };
  }, [callState?.status]);

  useEffect(() => {
    if (callState?.status === "connected") {
      timerRef.current = setInterval(() => setCallDuration(d => d + 1), 1000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [callState?.status]);

  useEffect(() => {
    if (!incomingCallData || !pcRef.current) return;
    if (incomingCallData.type === "call_offer" && callState?.direction === "incoming") {
      (async () => {
        const pc = pcRef.current!;
        await pc.setRemoteDescription(incomingCallData.offer);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        send({ type: "call_answer", targetUserId: callState!.remoteUser.id, answer });
      })();
    } else if (incomingCallData.type === "call_answer") {
      pcRef.current?.setRemoteDescription(incomingCallData.answer);
    } else if (incomingCallData.type === "ice_candidate" && incomingCallData.candidate) {
      pcRef.current?.addIceCandidate(incomingCallData.candidate);
    }
  }, [incomingCallData]);

  const endCall = useCallback(() => {
    send({ type: "call_end", targetUserId: callState?.remoteUser.id });
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    screenStreamRef.current?.getTracks().forEach(t => t.stop());
    pcRef.current?.close();
    if (timerRef.current) clearInterval(timerRef.current);
    onCallEnd();
  }, [callState?.remoteUser.id, send, onCallEnd]);

  const toggleMute = () => {
    localStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = !t.enabled; });
    setIsMuted(m => !m);
  };

  const toggleVideo = () => {
    localStreamRef.current?.getVideoTracks().forEach(t => { t.enabled = !t.enabled; });
    setIsVideoOff(v => !v);
  };

  const toggleScreenShare = async () => {
    if (!pcRef.current) return;
    if (isScreenSharing) {
      screenStreamRef.current?.getTracks().forEach(t => t.stop());
      const videoTrack = localStreamRef.current?.getVideoTracks()[0];
      if (videoTrack) {
        const sender = pcRef.current.getSenders().find(s => s.track?.kind === "video");
        sender?.replaceTrack(videoTrack);
      }
      setIsScreenSharing(false);
      send({ type: "screen_share_end", targetUserId: callState?.remoteUser.id });
    } else {
      try {
        const screen = await navigator.mediaDevices.getDisplayMedia({ video: true });
        screenStreamRef.current = screen;
        const screenTrack = screen.getVideoTracks()[0];
        const sender = pcRef.current.getSenders().find(s => s.track?.kind === "video");
        sender?.replaceTrack(screenTrack);
        screenTrack.onended = () => toggleScreenShare();
        setIsScreenSharing(true);
        send({ type: "screen_share_start", targetUserId: callState?.remoteUser.id });
      } catch {}
    }
  };

  const formatDuration = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  if (!callState) return null;

  const isConnected = callState.status === "connected";
  const isRinging = callState.status === "ringing";

  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex flex-col">
      <div className="absolute inset-0 bg-gradient-to-b from-black/50 to-black/80" />

      {callState.type === "video" && (
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="absolute inset-0 w-full h-full object-cover opacity-80"
        />
      )}

      <div className="relative z-10 flex flex-col h-full">
        <div className="flex items-center justify-between p-4 pt-6">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md bg-primary/20 flex items-center justify-center">
              {callState.type === "video" ? <Video className="w-4 h-4 text-primary" /> : <Phone className="w-4 h-4 text-primary" />}
            </div>
            <span className="text-white/70 text-sm font-medium">
              {callState.type === "video" ? "Video Call" : "Voice Call"}
            </span>
          </div>
          {isConnected && (
            <Badge variant="secondary" className="bg-green-500/20 text-green-400 border-green-500/20">
              {formatDuration(callDuration)}
            </Badge>
          )}
          {isScreenSharing && (
            <Badge variant="secondary" className="bg-blue-500/20 text-blue-400 border-blue-500/20">
              Sharing Screen
            </Badge>
          )}
        </div>

        <div className="flex-1 flex items-center justify-center">
          {(!isConnected || callState.type === "audio") && (
            <div className="text-center space-y-4">
              <Avatar className="w-24 h-24 mx-auto border-4 border-white/10">
                <AvatarFallback className="text-2xl bg-primary/20 text-primary">
                  {getInitials(callState.remoteUser.displayName)}
                </AvatarFallback>
              </Avatar>
              <div>
                <h2 className="text-white text-2xl font-semibold">{callState.remoteUser.displayName}</h2>
                <p className="text-white/50 text-sm mt-1">
                  {isRinging
                    ? callState.direction === "outgoing" ? "Calling..." : "Incoming call"
                    : isConnected ? "Connected" : "Call ended"}
                </p>
              </div>
            </div>
          )}
        </div>

        {callState.type === "video" && (
          <div className="absolute bottom-28 right-4 w-32 h-24 rounded-md overflow-hidden border border-white/20 bg-black">
            <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
          </div>
        )}

        <div className="pb-8 px-6">
          {isRinging && callState.direction === "incoming" ? (
            <div className="flex justify-center gap-6">
              <button
                data-testid="button-reject-call"
                onClick={() => {
                  send({ type: "call_reject", targetUserId: callState.remoteUser.id });
                  onCallEnd();
                }}
                className="w-16 h-16 rounded-full bg-destructive flex items-center justify-center hover-elevate"
              >
                <PhoneOff className="w-7 h-7 text-white" />
              </button>
              <button
                data-testid="button-accept-call"
                onClick={async () => {
                  const stream = await navigator.mediaDevices.getUserMedia({ video: callState.type === "video", audio: true });
                  localStreamRef.current = stream;
                  if (localVideoRef.current) localVideoRef.current.srcObject = stream;
                  const pc = createPC();
                  pcRef.current = pc;
                  stream.getTracks().forEach(t => pc.addTrack(t, stream));
                }}
                className="w-16 h-16 rounded-full bg-green-500 flex items-center justify-center hover-elevate"
              >
                <Phone className="w-7 h-7 text-white" />
              </button>
            </div>
          ) : (
            <div className="flex justify-center items-center gap-3 flex-wrap">
              <button
                data-testid="button-toggle-mute"
                onClick={toggleMute}
                className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${isMuted ? "bg-white/20 text-white" : "bg-white/10 text-white/70"}`}
              >
                {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </button>
              {callState.type === "video" && (
                <button
                  data-testid="button-toggle-video"
                  onClick={toggleVideo}
                  className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${isVideoOff ? "bg-white/20 text-white" : "bg-white/10 text-white/70"}`}
                >
                  {isVideoOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
                </button>
              )}
              <button
                data-testid="button-end-call"
                onClick={endCall}
                className="w-14 h-14 rounded-full bg-destructive flex items-center justify-center hover-elevate mx-2"
              >
                <PhoneOff className="w-6 h-6 text-white" />
              </button>
              <button
                data-testid="button-toggle-speaker"
                onClick={() => setIsSpeakerOff(s => !s)}
                className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${isSpeakerOff ? "bg-white/20 text-white" : "bg-white/10 text-white/70"}`}
              >
                {isSpeakerOff ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
              </button>
              <button
                data-testid="button-toggle-screen-share"
                onClick={toggleScreenShare}
                className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${isScreenSharing ? "bg-primary text-primary-foreground" : "bg-white/10 text-white/70"}`}
              >
                {isScreenSharing ? <MonitorOff className="w-5 h-5" /> : <Monitor className="w-5 h-5" />}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
