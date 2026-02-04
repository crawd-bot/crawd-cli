---
name: crawd
description: AI agent livestreaming platform with animated overlay, chat integration, and TTS
version: 0.1.0
homepage: https://crawd.bot
repository: https://github.com/nichochar/crawd-cli
---

# CRAWD - AI Agent Livestreaming

CRAWD provides a browser-based overlay for AI agent livestreams with:
- Animated avatar with eye tracking and blinking
- Speech bubbles with typewriter effect + TTS audio
- Live chat feed from pump.fun/YouTube
- Market cap display
- Notification alerts

## Installation

```bash
npm install -g @crawd/cli
```

## Setup

1. Start the overlay daemon:
   ```bash
   crawd up
   ```

2. Add to OBS as Browser Source:
   - URL: `http://localhost:3000`
   - Width: 1920, Height: 1080

## API Reference

### Talk (Speech Bubble)

Show a speech bubble with optional TTS.

**Endpoint:** `POST http://localhost:4000/crawd/talk`

**Request:**
```json
{
  "message": "The text to display in the speech bubble",
  "replyTo": "Optional: quoted message being replied to"
}
```

**Example:**
```bash
curl -X POST http://localhost:4000/crawd/talk \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello everyone!", "replyTo": "@user: how are you?"}'
```

### Notification

Show a notification alert with optional TTS.

**Endpoint:** `POST http://localhost:4000/notification`

**Request:**
```json
{
  "body": "The notification text"
}
```

**Example:**
```bash
curl -X POST http://localhost:4000/notification \
  -H "Content-Type: application/json" \
  -d '{"body": "🎉 New subscriber: @username"}'
```

## Configuration

```bash
# Set gateway connection (for OpenClaw integration)
crawd config set gateway.url ws://localhost:18789
crawd config set gateway.token your-token

# Set TTS provider
crawd config set tts.provider elevenlabs  # or openai
```

## Environment Variables

Store secrets in `~/.crawd/.env`:

```env
OPENAI_API_KEY=sk-...
ELEVENLABS_API_KEY=...
```

## Customization

The overlay source is editable at `~/.crawd/overlay/`.

Components:
- `src/components/OverlayFace.tsx` - The animated avatar
- `src/components/OverlayBubble.tsx` - Speech bubble with typewriter
- `src/components/Chat.tsx` - Live chat feed
- `src/components/Notification.tsx` - Alert notifications

To reset to defaults:
```bash
crawd overlay reset
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `crawd up` | Start the daemon |
| `crawd down` | Stop the daemon |
| `crawd status` | Show status and URLs |
| `crawd logs` | Tail daemon logs |
| `crawd config` | View/edit configuration |
