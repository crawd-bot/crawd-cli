import 'dotenv/config';
import { randomUUID } from "crypto";
import { writeFile, mkdir } from "fs/promises";
import { watch } from "fs";
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
import { Coordinator, type CoordinatorConfig, type CoordinatorEvent, type InvokeRequestPayload } from "./coordinator";
import { generateShortId } from "../lib/chat/types";
import { configureTikTokTTS, generateTikTokTTS } from "../lib/tts/tiktok";
import type { ChatMessage } from "../lib/chat/types";
import { loadEnv, loadConfig } from "../config/store.js";
import { ENV_PATH, CONFIG_PATH } from "../utils/paths.js";
import type { TtsProvider, ReplyTurnEvent, TalkEvent } from "../types";

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

// TTS provider selection — mutable, updated by file watcher
let CHAT_PROVIDER = (process.env.TTS_CHAT_PROVIDER || 'tiktok') as TtsProvider;
let CHAT_VOICE = process.env.TTS_CHAT_VOICE;
let BOT_PROVIDER = (process.env.TTS_BOT_PROVIDER || 'elevenlabs') as TtsProvider;
let BOT_VOICE = process.env.TTS_BOT_VOICE;

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

// --- Auto-reload ~/.crawd/.env and config.json on change ---

async function reloadConfig() {
  const env = loadEnv();
  const config = loadConfig();
  const changes: string[] = [];

  // Update secrets in process.env
  for (const [key, value] of Object.entries(env)) {
    if (value && process.env[key] !== value) {
      changes.push(key);
      process.env[key] = value;
    }
  }

  // Update TTS provider/voice from config
  const newChatProvider = (config.tts.chatProvider || 'tiktok') as TtsProvider;
  const newChatVoice = config.tts.chatVoice;
  const newBotProvider = (config.tts.botProvider || 'elevenlabs') as TtsProvider;
  const newBotVoice = config.tts.botVoice;

  if (newChatProvider !== CHAT_PROVIDER) { changes.push('tts.chatProvider'); CHAT_PROVIDER = newChatProvider; }
  if (newChatVoice !== CHAT_VOICE) { changes.push('tts.chatVoice'); CHAT_VOICE = newChatVoice; }
  if (newBotProvider !== BOT_PROVIDER) { changes.push('tts.botProvider'); BOT_PROVIDER = newBotProvider; }
  if (newBotVoice !== BOT_VOICE) { changes.push('tts.botVoice'); BOT_VOICE = newBotVoice; }

  // Reinitialize ElevenLabs client if key changed
  if (changes.includes('ELEVENLABS_API_KEY') && process.env.ELEVENLABS_API_KEY) {
    try {
      const { ElevenLabsClient } = await import("@elevenlabs/elevenlabs-js");
      elevenlabs = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });
    } catch { /* already warned at startup */ }
  }

  // Reconfigure TikTok TTS if session ID changed
  if (changes.includes('TIKTOK_SESSION_ID') && process.env.TIKTOK_SESSION_ID) {
    configureTikTokTTS(process.env.TIKTOK_SESSION_ID);
  }

  if (changes.length > 0) {
    fastify.log.info({ changes }, 'Config reloaded');
  }
}

let reloadTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleReload() {
  if (reloadTimer) clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => reloadConfig(), 100);
}

for (const file of [ENV_PATH, CONFIG_PATH]) {
  try {
    watch(file, () => scheduleReload());
  } catch { /* file may not exist yet */ }
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
function chatTTS(text: string) { return tts(text, CHAT_PROVIDER, CHAT_VOICE); }

/** Generate TTS for a bot message (uses BOT_PROVIDER) */
function botTTS(text: string) { return tts(text, BOT_PROVIDER, BOT_VOICE); }

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

  // --- Pending talk ack tracking (for synchronous talk tool calls) ---
  const pendingTalkAcks = new Map<string, { resolve: () => void; timer: ReturnType<typeof setTimeout> }>();
  const TALK_ACK_TIMEOUT_MS = 60_000;

  function waitForTalkAck(talkId: string): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingTalkAcks.delete(talkId);
        fastify.log.warn({ talkId }, 'Talk ack timed out, resolving anyway');
        resolve();
      }, TALK_ACK_TIMEOUT_MS);
      pendingTalkAcks.set(talkId, { resolve, timer });
    });
  }

  function resolveTalkAck(talkId: string) {
    const pending = pendingTalkAcks.get(talkId);
    if (pending) {
      clearTimeout(pending.timer);
      pendingTalkAcks.delete(talkId);
      pending.resolve();
    }
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
        }
        // Note: chatProcessed no longer emits status — we only wake/emit
        // when the agent actually replies (via talk tool or text fallback).
      });

      /**
       * Generate TTS and emit atomic talk event, wait for overlay ack.
       * If replyTo is provided, also generates chat TTS — overlay plays chat first, then bot.
       */
      async function handleTalkInvoke(text: string, replyTo?: ChatMessage): Promise<void> {
        const talkId = randomUUID();
        fastify.log.info({ talkId, text: text.slice(0, 80), replyTo: replyTo?.shortId }, 'Handling talk invoke');

        // Generate TTS in parallel when there's a chat message to reply to
        const [ttsUrl, chatTtsUrl] = await Promise.all([
          botTTS(text),
          replyTo ? chatTTS(`Chat says: ${replyTo.message}`) : Promise.resolve(undefined),
        ]);

        const event: TalkEvent = { id: talkId, message: text, ttsUrl };
        if (replyTo && chatTtsUrl) {
          event.chat = {
            message: replyTo.message,
            username: replyTo.username,
            ttsUrl: chatTtsUrl,
          };
        }

        io.emit('crawd:talk', event);
        fastify.log.info({ talkId, hasChat: !!event.chat }, 'Emitted crawd:talk, waiting for ack');

        await waitForTalkAck(talkId);
        fastify.log.info({ talkId }, 'Talk complete');
      }

      // Fallback: when agent replies with text (instead of using the talk tool),
      // still generate TTS and emit to overlay. If replyTo is available, bundle it.
      coordinator.onTextReply = async (text: string, replyTo?: ChatMessage) => {
        fastify.log.info({ text: text.slice(0, 80), replyTo: replyTo?.shortId }, 'Agent text reply fallback → talk');
        await handleTalkInvoke(text, replyTo);
      };

      try {
        await coordinator.start();
        fastify.log.info('Coordinator connected to gateway');

        // Register invoke handler on gateway client for the talk command
        const gateway = coordinator.getGateway();
        if (gateway) {
          gateway.onInvokeRequest = async (payload: InvokeRequestPayload) => {
            fastify.log.info({ command: payload.command, id: payload.id }, 'Invoke request received');

            if (payload.command === 'talk') {
              try {
                const params = payload.paramsJSON ? JSON.parse(payload.paramsJSON) : {};
                const text = params.text;
                if (!text || typeof text !== 'string') {
                  await gateway.sendInvokeResult(payload.id, payload.nodeId, {
                    ok: false,
                    error: { code: 'INVALID_PARAMS', message: 'text parameter is required' },
                  });
                  return;
                }

                // Agent is actively speaking — wake the coordinator
                if (coordinator && coordinator.state !== 'active') {
                  coordinator.wake();
                } else {
                  coordinator?.resetActivity();
                }

                // Look up replyTo chat message if provided
                const replyTo = params.replyTo && coordinator
                  ? coordinator.getRecentMessage(params.replyTo)
                  : undefined;

                await handleTalkInvoke(text, replyTo);
                await gateway.sendInvokeResult(payload.id, payload.nodeId, {
                  ok: true,
                  payload: { spoken: true },
                });
              } catch (err) {
                fastify.log.error(err, 'Talk invoke failed');
                await gateway.sendInvokeResult(payload.id, payload.nodeId, {
                  ok: false,
                  error: { code: 'TTS_FAILED', message: String(err) },
                });
              }
            } else {
              fastify.log.warn({ command: payload.command }, 'Unknown invoke command');
              await gateway.sendInvokeResult(payload.id, payload.nodeId, {
                ok: false,
                error: { code: 'UNKNOWN_COMMAND', message: `Unknown command: ${payload.command}` },
              });
            }
          };
        }
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

    // Listen for talk:done acks from overlay
    socket.on("crawd:talk:done", (data: { id: string }) => {
      if (data?.id) {
        fastify.log.info({ talkId: data.id }, 'Talk ack received from overlay');
        resolveTalkAck(data.id);
      }
    });

    socket.on("disconnect", () => {
      fastify.log.info(`socket disconnected: ${socket.id}`);
    });
  });

  fastify.post<{ Body: { message: string } }>(
    "/crawd/talk",
    async (request, reply) => {
      const { message } = request.body;
      if (!message || typeof message !== "string") {
        return reply.status(400).send({ error: "message is required" });
      }

      try {
        const talkId = randomUUID();
        const ttsUrl = await botTTS(message);
        const event: TalkEvent = { id: talkId, message, ttsUrl };
        io.emit("crawd:talk", event);
        return { ok: true, id: talkId };
      } catch (e) {
        fastify.log.error(e, "failed to generate TTS");
        return reply.status(500).send({ error: "Failed to generate TTS" });
      }
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
