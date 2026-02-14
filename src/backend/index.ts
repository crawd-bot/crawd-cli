import 'dotenv/config';
import { randomUUID } from "crypto";
import { watch } from "fs";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { Server } from "socket.io";
import { pumpfun } from "../lib/pumpfun/v2";
import { ChatManager } from "../lib/chat/manager";
import { PumpFunChatClient } from "../lib/chat/pumpfun/client";
import { YouTubeChatClient } from "../lib/chat/youtube/client";
import { GatewayClient, Coordinator, type CoordinatorConfig, type CoordinatorEvent, type InvokeRequestPayload } from "./coordinator";
import { generateShortId } from "../lib/chat/types";
import type { ChatMessage } from "../lib/chat/types";
import { loadEnv } from "../config/store.js";
import { ENV_PATH, CONFIG_PATH } from "../utils/paths.js";

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
const TOKEN_MINT = process.env.NEXT_PUBLIC_TOKEN_MINT;
const MCAP_POLL_MS = 10_000;

// Unique version ID generated at startup - changes on each deploy/restart
const BUILD_VERSION = randomUUID();

const fastify = Fastify({ logger: true });

// --- Auto-reload ~/.crawd/.env and config.json on change ---

async function reloadConfig() {
  const env = loadEnv();
  const changes: string[] = [];

  // Update secrets in process.env
  for (const [key, value] of Object.entries(env)) {
    if (value && process.env[key] !== value) {
      changes.push(key);
      process.env[key] = value;
    }
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
  await fastify.register(cors, { origin: true });

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
      const gateway = new GatewayClient(gatewayUrl, gatewayToken);
      const coordConfig = parseCoordinatorConfig();
      coordinator = new Coordinator(gateway.triggerAgent.bind(gateway), coordConfig);

      // Emit coordinator status changes to frontend
      coordinator.setOnEvent((event: CoordinatorEvent) => {
        if (event.type === 'stateChange') {
          const status = event.to;
          io.emit('crawd:status', { status });
        } else if (event.type === 'vibeExecuted' && !event.skipped) {
          io.emit('crawd:status', { status: 'vibing' });
        }
      });

      /**
       * Emit text-only talk event, wait for overlay ack.
       * If replyTo is provided, emits reply-turn instead of talk.
       */
      async function handleTalkInvoke(text: string, replyTo?: ChatMessage): Promise<void> {
        const talkId = randomUUID();
        fastify.log.info({ talkId, text: text.slice(0, 80), replyTo: replyTo?.shortId }, 'Handling talk invoke');

        if (replyTo) {
          io.emit('crawd:reply-turn', {
            id: talkId,
            chat: { username: replyTo.username, message: replyTo.message },
            botMessage: text,
          });
        } else {
          io.emit('crawd:talk', { id: talkId, message: text });
        }

        fastify.log.info({ talkId, hasChat: !!replyTo }, 'Emitted event, waiting for ack');

        await waitForTalkAck(talkId);
        fastify.log.info({ talkId }, 'Talk complete');
      }

      try {
        await gateway.connect();
        coordinator.start();
        fastify.log.info('Coordinator started, gateway connected');

        // Register invoke handler on gateway client for the talk command
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
                error: { code: 'INVOKE_FAILED', message: String(err) },
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
      } catch (err) {
        fastify.log.error(err, 'Failed to connect to gateway');
        gateway.disconnect();
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

      const talkId = randomUUID();
      io.emit("crawd:talk", { id: talkId, message });
      return { ok: true, id: talkId };
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

  // Mock turn endpoint for debug UI — text-only
  fastify.post<{ Body: { username: string; message: string; response: string } }>(
    "/mock/turn",
    async (request, reply) => {
      const { username, message, response } = request.body;
      if (!username || !message || !response) {
        return reply.status(400).send({ error: "username, message, and response are required" });
      }

      fastify.log.info({ username, message, response }, "mock turn");

      const id = randomUUID();
      io.emit('crawd:reply-turn', {
        id,
        chat: { username, message },
        botMessage: response,
      });

      return { ok: true, id };
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
