# NexusComm - Private Employee Communication Platform

## Overview
A full-featured private communication platform for enterprise teams, featuring real-time messaging, audio/video calling, screen sharing, file sharing, and employee tracking. Installable as a native-feeling app on iPhone/Android via PWA (Progressive Web App).

## Features
- **Authentication**: Session-based login/register with hashed passwords
- **Channels**: Group messaging channels with join/leave support
- **Direct Messages**: Private 1:1 messaging
- **Real-time Messaging**: WebSocket-powered instant messaging
- **File Sharing**: Upload and share files/images in chat
- **Video/Audio Calling**: WebRTC peer-to-peer calls (audio + video)
- **Screen Sharing**: WebRTC-based screen capture and sharing
- **Employee Directory**: Searchable grid with department filtering
- **Presence Tracking**: Online/Away/Busy/Offline status
- **Dark/Light Mode**: Theme toggle with localStorage persistence

## Architecture

### Frontend (`client/src/`)
- `App.tsx` - Auth-aware router, redirects based on login state
- `pages/login.tsx` - Login + Register forms with tabs
- `pages/chat.tsx` - Main app: sidebar + chat window, manages all state
- `components/app-sidebar.tsx` - Shadcn sidebar with channels, DMs, user menu
- `components/chat-window.tsx` - Messages display + input with file upload
- `components/call-overlay.tsx` - Fullscreen video/audio call UI with WebRTC
- `components/employee-directory.tsx` - Employee grid with search/filter
- `hooks/use-auth.ts` - Auth state via TanStack Query
- `hooks/use-websocket.ts` - WebSocket connection + event routing

### Backend (`server/`)
- `index.ts` - Express + session middleware + static serving
- `routes.ts` - REST API + WebSocket server
- `storage.ts` - PostgreSQL via Drizzle ORM + seed data

### Shared (`shared/`)
- `schema.ts` - Drizzle schema + Zod validation + TypeScript types

## Tech Stack
- **Runtime**: Node.js + Express
- **Database**: PostgreSQL via Drizzle ORM
- **Frontend**: React + Vite + TanStack Query
- **Real-time**: ws (WebSockets)
- **Video/Call**: WebRTC (browser native)
- **Auth**: express-session + connect-pg-simple
- **Styling**: Tailwind CSS + shadcn/ui
- **File Upload**: multer

## Database Tables
- `users` - Employee profiles with status
- `channels` - Public/private group channels
- `channel_members` - Many-to-many channel membership
- `messages` - Chat messages (channel or DM) with file attachments
- `calls` - Call history

## Seed Data
On first startup, 6 employee accounts are created with 5 channels and sample messages.
Default credentials: `admin` / `password123`

## SSH Terminal
- Built-in SSH client accessible from the sidebar under "Tools → SSH Terminal"
- `client/src/components/ssh-terminal.tsx` — full terminal UI using xterm.js
- `server/routes.ts` — SSH WebSocket server at `/ssh` path using the `ssh2` npm package
- Supports both password and private key (PEM) authentication
- Multiple simultaneous sessions via tabbed interface
- Full terminal emulation: xterm-256color, resize, scrollback (5000 lines)
- Session tabs with live status indicators (green=connected, yellow=connecting, red=error)
- Auto-disconnect cleanup when tab is closed

## Dropbox Integration
- Connected via Replit OAuth integration (no API key required)
- Full Dropbox access — browse root and all folders, not limited to `/NexusComm`
- `server/dropbox.ts` — Dropbox client helper using the integration token
- Routes:
  - `POST /api/dropbox/upload` — Upload a file to Dropbox, returns a public share link
  - `GET /api/dropbox/files?folder=/path` — List files in any Dropbox folder (root if omitted)
  - `POST /api/dropbox/share` — Get a shareable link for an existing Dropbox file
- In the chat UI: attachment button dropdown shows "Upload to Dropbox" and "Browse Dropbox files"
- The Dropbox icon (blue) appears in the chat header and on shared Dropbox files
- Shared Dropbox files open in Dropbox via external link

## Quick Links (Sidebar)
External links in the sidebar under "Quick Links" section, each opening in a new tab:
- PDS Admin → pdslive.media/admin
- Seismic Panel → seismic.sx:8087/login
- P2S Panel → p2smrbponly.net:8087/login
- OTWT Panel → onlytimewilltell.xyz:8087/login
- Termius → termius.com

## Google Docs Sharing
- Share any Google Docs/Sheets/Slides/Drive link directly in chat via the attachment menu
- REST endpoint: `POST /api/messages/share-link` — saves the link as a file message and broadcasts via WebSocket
- Rich preview card rendered in chat with appropriate Google icon (blue/green/yellow), label, and type
- No OAuth required — users paste any shareable Google link

## Media Player
- Web-based VLC-style media player accessible from the sidebar under "Tools → Media Player"
- `client/src/components/media-player.tsx` — full media player UI
- Supports adding video/audio files from disk or by URL
- HTML5 video element supports: mp4, webm, ogg, and other browser-native formats
- **HLS streaming** via hls.js — paste any .m3u8 URL for live or VOD HLS playback; auto quality switching with manual override buttons
- **M3U playlist parsing** — load .m3u or .m3u8 files from disk or URL; each entry is extracted and added as a separate playlist item; supports #EXTINF and #EXT-X-STREAM-INF tags
- Live stream detection — shows red LIVE badge and animated progress bar for infinite-duration HLS streams; seek/skip disabled for live
- HLS error recovery — automatic NETWORK_ERROR retry and MEDIA_ERROR recovery via hls.js
- Playlist management: add/remove items, auto-play on first item added
- Controls: play/pause, seek bar, volume slider, skip ±10s, prev/next track
- Loop and shuffle modes
- Fullscreen support via browser Fullscreen API
- "Now playing" label with stream type badge (HLS, AUDIO) and buffering indicator

## Development
```
npm run dev         # Start dev server (port 5000)
npm run db:push     # Push schema changes to database
```
