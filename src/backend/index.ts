import 'dotenv/config';
import { randomUUID } from "crypto";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import cors from "@fastify/cors";
import { Server } from "socket.io";
import OpenAI from "openai";
import { pumpfun } from "../lib/pumpfun/v2";
import { ChatManager } from "../lib/chat/manager";
import { PumpFunChatClient } from "../lib/chat/pumpfun/client";
import { YouTubeChatClient } from "../lib/chat/youtube/client";
import { Coordinator, type AgentReply, type CoordinatorConfig, type CoordinatorEvent } from "./coordinator";
import { generateShortId } from "../lib/chat/types";
import { configureTikTokTTS, generateTikTokTTS } from "../lib/tts/tiktok";
import type { ChatMessage } from "../lib/chat/types";
import type { TtsProvider, ReplyTurnEvent } from "../types";

// Parse coordinator config from env vars
function parseCoordinatorConfig(): Partial<CoordinatorConfig> {
  const config: Partial<CoordinatorConfig> = {};

  if (process.env.VIBE_ENABLED !== undefined) {
    config.vibeEnabled = process.env.VIBE_ENABLED === 'true';
  }
  if (process.env.VIBE_INTERVAL_MS) {
    config.vibeIntervalMs = Number(process.env.VIBE_INTERVAL_MS);
  }
  if (process.env.IDLE_AFTER_MS) {
    config.idleAfterMs = Number(process.env.IDLE_AFTER_MS);
  }
  if (process.env.SLEEP_AFTER_IDLE_MS) {
    config.sleepAfterIdleMs = Number(process.env.SLEEP_AFTER_IDLE_MS);
  }
  if (process.env.VIBE_PROMPT) {
    config.vibePrompt = process.env.VIBE_PROMPT;
  }

  return config;
}

const port = Number(process.env.PORT || 4000);
const BACKEND_URL = process.env.BACKEND_URL || `http://localhost:${port}`;
const TOKEN_MINT = process.env.NEXT_PUBLIC_TOKEN_MINT;
const MCAP_POLL_MS = 10_000;
const TTS_DIR = join(process.cwd(), "tmp", "tts");

// TTS provider selection from config (passed as env vars by `crawd start`)
const CHAT_PROVIDER = (process.env.TTS_CHAT_PROVIDER || 'tiktok') as TtsProvider;
const CHAT_VOICE = process.env.TTS_CHAT_VOICE;
const BOT_PROVIDER = (process.env.TTS_BOT_PROVIDER || 'elevenlabs') as TtsProvider;
const BOT_VOICE = process.env.TTS_BOT_VOICE;

// Unique version ID generated at startup - changes on each deploy/restart
const BUILD_VERSION = randomUUID();

const fastify = Fastify({ logger: true });
const openai = new OpenAI();

// Dynamic import for optional ElevenLabs dependency
let elevenlabs: any = null;
if (process.env.ELEVENLABS_API_KEY) {
  try {
    const { ElevenLabsClient } = await import("@elevenlabs/elevenlabs-js");
    elevenlabs = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });
  } catch {
    fastify.log.warn("@elevenlabs/elevenlabs-js not installed, ElevenLabs TTS disabled");
  }
}

// Configure TikTok TTS if session ID is available
if (process.env.TIKTOK_SESSION_ID) {
  configureTikTokTTS(process.env.TIKTOK_SESSION_ID);
}

// --- TTS provider functions ---

async function generateOpenAITTS(text: string, voice?: string): Promise<string> {
  const response = await openai.audio.speech.create({
    model: "tts-1-hd",
    voice: (voice || "onyx") as "onyx",
    input: text,
  });

  const buffer = Buffer.from(await response.arrayBuffer());
  const filename = `${randomUUID()}.mp3`;
  await mkdir(TTS_DIR, { recursive: true });
  await writeFile(join(TTS_DIR, filename), buffer);

  return `${BACKEND_URL}/tts/${filename}`;
}

async function generateElevenLabsTTS(text: string, voice?: string): Promise<string> {
  if (!elevenlabs) throw new Error("ELEVENLABS_API_KEY not configured");

  const audio = await elevenlabs.textToSpeech.convert(voice || "TX3LPaxmHKxFdv7VOQHJ", {
    modelId: "eleven_multilingual_v2",
    text,
    outputFormat: "mp3_44100_128",
    voiceSettings: {
      stability: 0,
      similarityBoost: 1.0,
      useSpeakerBoost: true,
      speed: 1.0,
    },
  });

  // Convert stream to buffer - works with Bun and Node.js
  const response = new Response(audio as any);
  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Check if response is valid MP3 (starts with ID3 or FF FB/FA/F3/F2)
  const isMP3 = (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) || // ID3
                (buffer[0] === 0xFF && (buffer[1] & 0xE0) === 0xE0); // MP3 frame sync

  if (!isMP3) {
    const preview = buffer.subarray(0, 200).toString("utf-8");
    console.error(`ElevenLabs returned non-audio response: ${preview}`);
    throw new Error("ElevenLabs returned invalid audio (possibly error page)");
  }

  const filename = `${randomUUID()}.mp3`;
  await mkdir(TTS_DIR, { recursive: true });
  await writeFile(join(TTS_DIR, filename), buffer);

  console.log(`TTS file written: ${filename}, size: ${buffer.length} bytes`);

  return `${BACKEND_URL}/tts/${filename}`;
}

async function generateTikTokTTSFile(text: string, voice?: string): Promise<string> {
  const buffer = await generateTikTokTTS(text, voice);
  const filename = `${randomUUID()}.mp3`;
  await mkdir(TTS_DIR, { recursive: true });
  await writeFile(join(TTS_DIR, filename), buffer);
  console.log(`TikTok TTS file written: ${filename}, size: ${buffer.length} bytes`);
  return `${BACKEND_URL}/tts/${filename}`;
}

/** Generate TTS using the specified provider and voice, falling back to OpenAI on failure */
async function tts(text: string, provider: TtsProvider, voice?: string): Promise<string> {
  const providers: Record<TtsProvider, () => Promise<string>> = {
    openai: () => generateOpenAITTS(text, voice),
    elevenlabs: () => generateElevenLabsTTS(text, voice),
    tiktok: () => generateTikTokTTSFile(text, voice),
  };

  try {
    return await providers[provider]();
  } catch (e) {
    if (provider !== 'openai') {
      fastify.log.warn(e, `${provider} TTS failed, falling back to OpenAI`);
      return await generateOpenAITTS(text);
    }
    throw e;
  }
}

/** Generate TTS for a chat message (uses CHAT_PROVIDER) */
const chatTTS = (text: string) => tts(text, CHAT_PROVIDER, CHAT_VOICE);

/** Generate TTS for a bot message (uses BOT_PROVIDER) */
const botTTS = (text: string) => tts(text, BOT_PROVIDER, BOT_VOICE);

// --- Non-TTS helpers ---

async function fetchMarketCap(): Promise<number | null> {
  if (!TOKEN_MINT) return null;

  try {
    const coin = await pumpfun.getCoin(TOKEN_MINT);
    return coin.usd_market_cap;
  } catch (e) {
    fastify.log.error(e, "failed to fetch market cap");
    return null;
  }
}

async function main() {
  fastify.log.info({ chatProvider: CHAT_PROVIDER, botProvider: BOT_PROVIDER }, 'TTS providers configured');

  await fastify.register(cors, { origin: true });
  await mkdir(TTS_DIR, { recursive: true });
  await fastify.register(fastifyStatic, {
    root: TTS_DIR,
    prefix: "/tts/",
    decorateReply: false,
  });

  const io = new Server(fastify.server, {
    cors: { origin: "*" },
  });

  let latestMcap: number | null = null;

  async function pollMarketCap() {
    fastify.log.info("polling market cap");
    const mcap = await fetchMarketCap();
    fastify.log.info({ mcap }, `fetched market cap: ${mcap}`);

    if (mcap === null) return;

    latestMcap = mcap;
    io.emit("crawd:mcap", { mcap });
  }

  // Chat manager and coordinator instances
  let chatManager: ChatManager | null = null;
  let coordinator: Coordinator | null = null;

  async function startChatSystem() {
    chatManager = new ChatManager();

    // Register Pump Fun client if enabled
    if (process.env.PUMPFUN_ENABLED !== 'false' && TOKEN_MINT) {
      chatManager.registerClient('pumpfun', new PumpFunChatClient(
        TOKEN_MINT,
        process.env.PUMPFUN_AUTH_TOKEN ?? null
      ));
    }

    // Register YouTube client if enabled
    if (process.env.YOUTUBE_ENABLED === 'true' && process.env.YOUTUBE_VIDEO_ID) {
      chatManager.registerClient('youtube', new YouTubeChatClient(
        process.env.YOUTUBE_VIDEO_ID
      ));
    }

    // Unified message handler
    chatManager.onMessage((msg: ChatMessage) => {
      fastify.log.info({ platform: msg.platform, user: msg.username }, 'chat message');

      // Emit to frontend overlay
      io.emit('crawd:chat', msg);

      // Send to coordinator for batching (if connected)
      coordinator?.onMessage(msg);
    });

    // Start coordinator if gateway is configured
    const gatewayUrl = process.env.OPENCLAW_GATEWAY_URL;
    const gatewayToken = process.env.OPENCLAW_GATEWAY_TOKEN;

    if (gatewayUrl && gatewayToken) {
      const coordConfig = parseCoordinatorConfig();
      coordinator = new Coordinator(gatewayUrl, gatewayToken, coordConfig);

      // Emit coordinator status changes to frontend
      coordinator.setOnEvent((event: CoordinatorEvent) => {
        if (event.type === 'stateChange') {
          const status = event.to;
          io.emit('crawd:status', { status });
        } else if (event.type === 'vibeExecuted' && !event.skipped) {
          io.emit('crawd:status', { status: 'vibing' });
        } else if (event.type === 'chatProcessed') {
          io.emit('crawd:status', { status: 'chatting' });
        }
      });

      // Filter out technical error messages that shouldn't be voiced
      const shouldSkipMessage = (text: string): boolean => {
        const normalized = text.trim().toLowerCase();
        if (normalized.length < 2) return true;
        if (normalized === 'none') return true;
        if (/^\d{3}\s*(status|error|code)/i.test(text)) return true;
        if (/status\s*code.*\d{3}/i.test(text)) return true;
        if (/^\(no\s*body\)$/i.test(normalized)) return true;
        return false;
      };

      // When agent replies, emit appropriate event
      coordinator.setOnAgentReply(async (reply: AgentReply) => {
        const { text, replyTo, originalMessage } = reply;
        fastify.log.info({ text, replyTo, hasOriginal: !!originalMessage }, 'Agent replied');

        if (shouldSkipMessage(text)) {
          fastify.log.info({ text }, 'Skipping technical/error message');
          return;
        }

        if (originalMessage) {
          // Reply to chat message — turn-based flow
          fastify.log.info({ username: originalMessage.username }, 'Generating turn with both TTS files');

          try {
            const [chatTtsUrl, botTtsUrl] = await Promise.all([
              chatTTS(`Chat says: ${originalMessage.message}`),
              botTTS(text),
            ]);

            const event: ReplyTurnEvent = {
              chat: { username: originalMessage.username, message: originalMessage.message },
              botMessage: text,
              chatTtsUrl,
              botTtsUrl,
            };

            fastify.log.info({ chatTtsUrl, botTtsUrl }, 'Emitting crawd:reply-turn');
            io.emit('crawd:reply-turn', event);
          } catch (e) {
            fastify.log.error(e, 'Failed to generate TTS for reply turn, falling back to talk');
            io.emit('crawd:talk', { message: text, replyTo });
            botTTS(text)
              .then((ttsUrl) => io.emit('crawd:tts', { ttsUrl }))
              .catch((err) => fastify.log.error(err, 'Failed to generate fallback TTS'));
          }
        } else {
          // Vibe/spontaneous message
          fastify.log.info({ message: text }, 'Emitting crawd:talk (vibe)');
          io.emit('crawd:talk', { message: text, replyTo: null });

          botTTS(text)
            .then((ttsUrl) => {
              fastify.log.info({ ttsUrl }, 'TTS generated for vibe');
              io.emit('crawd:tts', { ttsUrl });
            })
            .catch((e) => {
              fastify.log.error(e, 'failed to generate TTS for vibe');
            });
        }
      });

      try {
        await coordinator.start();
        fastify.log.info('Coordinator connected to gateway');
      } catch (err) {
        fastify.log.error(err, 'Failed to connect coordinator to gateway');
        coordinator = null;
      }
    } else {
      fastify.log.warn('Gateway not configured - coordinator disabled');
    }

    // Connect all chat clients
    await chatManager.connectAll();
  }

  io.on("connection", (socket) => {
    fastify.log.info(`socket connected: ${socket.id}`);

    if (latestMcap !== null) {
      socket.emit("crawd:mcap", { mcap: latestMcap });
    }

    socket.on("disconnect", () => {
      fastify.log.info(`socket disconnected: ${socket.id}`);
    });
  });

  fastify.post<{ Body: { message: string; replyTo?: string } }>(
    "/crawd/talk",
    async (request, reply) => {
      const { message, replyTo } = request.body;
      if (!message || typeof message !== "string") {
        return reply.status(400).send({ error: "message is required" });
      }

      io.emit("crawd:talk", { message, replyTo: replyTo ?? null });

      botTTS(message)
        .then((ttsUrl) => {
          fastify.log.info({ ttsUrl }, "TTS generated, emitting crawd:tts");
          io.emit("crawd:tts", { ttsUrl });
        })
        .catch((e) => {
          fastify.log.error(e, "failed to generate TTS");
        });

      return { ok: true };
    }
  );

  fastify.get("/chat/status", async () => {
    return { connected: chatManager?.getConnectedKeys() ?? [] };
  });

  fastify.get("/version", async () => {
    return { version: BUILD_VERSION };
  });

  fastify.get("/coordinator/status", async () => {
    if (!coordinator) {
      return { enabled: false };
    }
    return { enabled: true, ...coordinator.getState() };
  });

  fastify.post<{ Body: Partial<CoordinatorConfig> }>(
    "/coordinator/config",
    async (request, reply) => {
      if (!coordinator) {
        return reply.status(400).send({ error: "Coordinator not enabled" });
      }

      const config = request.body;
      coordinator.updateConfig(config);
      return { ok: true, ...coordinator.getState() };
    }
  );

  fastify.post<{ Body: { username: string; message: string } }>(
    "/mock/chat",
    async (request, reply) => {
      const { username, message } = request.body;
      if (!username || !message) {
        return reply.status(400).send({ error: "username and message are required" });
      }

      const id = randomUUID();
      const mockMsg: ChatMessage = {
        id,
        shortId: generateShortId(),
        username,
        message,
        platform: 'pumpfun',
        timestamp: Date.now(),
      };

      fastify.log.info({ username, message }, "mock chat message");
      io.emit("crawd:chat", mockMsg);
      coordinator?.onMessage(mockMsg);
      return { ok: true, id };
    }
  );

  // Mock turn endpoint for debug UI — generates real TTS
  fastify.post<{ Body: { username: string; message: string; response: string } }>(
    "/mock/turn",
    async (request, reply) => {
      const { username, message, response } = request.body;
      if (!username || !message || !response) {
        return reply.status(400).send({ error: "username, message, and response are required" });
      }

      fastify.log.info({ username, message, response }, "mock turn");

      try {
        const [chatTtsUrl, botTtsUrl] = await Promise.all([
          chatTTS(`Chat says: ${message}`),
          botTTS(response),
        ]);

        const event: ReplyTurnEvent = {
          chat: { username, message },
          botMessage: response,
          chatTtsUrl,
          botTtsUrl,
        };

        io.emit('crawd:reply-turn', event);

        return { ok: true };
      } catch (e) {
        fastify.log.error(e, "failed to generate mock turn TTS");
        return reply.status(500).send({ error: "Failed to generate TTS" });
      }
    }
  );

  await startChatSystem();

  const host = process.env.BIND_HOST || "0.0.0.0";
  await fastify.listen({ port, host });

  pollMarketCap();
  setInterval(pollMarketCap, MCAP_POLL_MS);

  fastify.log.info("Chat system started");
}

main();
