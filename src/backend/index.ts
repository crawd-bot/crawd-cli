import 'dotenv/config'
import { randomUUID } from 'crypto'
import { writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import cors from '@fastify/cors'
import { Server } from 'socket.io'

const port = Number(process.env.CRAWD_BACKEND_PORT || process.env.PORT || 4000)
const BACKEND_URL = process.env.BACKEND_URL || `http://localhost:${port}`
const TTS_DIR = process.env.CRAWD_TTS_DIR || join(process.cwd(), 'tmp', 'tts')

const fastify = Fastify({ logger: true })

// Optional OpenAI for TTS
let openai: any = null
try {
  const OpenAI = await import('openai')
  if (process.env.OPENAI_API_KEY) {
    openai = new OpenAI.default()
  }
} catch {
  fastify.log.warn('OpenAI not available - TTS disabled')
}

// Optional ElevenLabs for TTS
let elevenlabs: any = null
try {
  const ElevenLabs = await import('@elevenlabs/elevenlabs-js')
  if (process.env.ELEVENLABS_API_KEY) {
    elevenlabs = new ElevenLabs.ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY })
  }
} catch {
  fastify.log.warn('ElevenLabs not available')
}

async function generateTTS(text: string): Promise<string | null> {
  if (!openai) {
    fastify.log.warn('OpenAI not configured - skipping TTS')
    return null
  }

  try {
    const response = await openai.audio.speech.create({
      model: 'tts-1-hd',
      voice: 'onyx',
      input: text,
    })

    const buffer = Buffer.from(await response.arrayBuffer())
    const filename = `${randomUUID()}.mp3`
    await mkdir(TTS_DIR, { recursive: true })
    await writeFile(join(TTS_DIR, filename), buffer)

    return `${BACKEND_URL}/tts/${filename}`
  } catch (err) {
    fastify.log.error(err, 'Failed to generate TTS')
    return null
  }
}

async function generateElevenLabsTTS(text: string): Promise<string | null> {
  if (!elevenlabs) {
    return null
  }

  try {
    const audio = await elevenlabs.textToSpeech.convert('TX3LPaxmHKxFdv7VOQHJ', {
      modelId: 'eleven_multilingual_v2',
      text,
      outputFormat: 'mp3_44100_128',
      voiceSettings: {
        stability: 0,
        similarityBoost: 1.0,
        useSpeakerBoost: true,
        speed: 1.0,
      },
    })

    const response = new Response(audio as any)
    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Validate MP3
    const isMP3 = (buffer[0] === 0x49 && buffer[1] === 0x44 && buffer[2] === 0x33) ||
                  (buffer[0] === 0xFF && (buffer[1] & 0xE0) === 0xE0)

    if (!isMP3) {
      throw new Error('Invalid audio response')
    }

    const filename = `${randomUUID()}.mp3`
    await mkdir(TTS_DIR, { recursive: true })
    await writeFile(join(TTS_DIR, filename), buffer)

    return `${BACKEND_URL}/tts/${filename}`
  } catch (err) {
    fastify.log.error(err, 'ElevenLabs TTS failed')
    return null
  }
}

async function generateTTSWithFallback(text: string): Promise<string | null> {
  // Try ElevenLabs first
  if (elevenlabs) {
    const url = await generateElevenLabsTTS(text)
    if (url) return url
  }

  // Fall back to OpenAI
  return generateTTS(text)
}

async function main() {
  await fastify.register(cors, { origin: true })
  await mkdir(TTS_DIR, { recursive: true })
  await fastify.register(fastifyStatic, {
    root: TTS_DIR,
    prefix: '/tts/',
    decorateReply: false,
  })

  const io = new Server(fastify.server, {
    cors: { origin: '*' },
  })

  io.on('connection', (socket) => {
    fastify.log.info(`Socket connected: ${socket.id}`)

    socket.on('disconnect', () => {
      fastify.log.info(`Socket disconnected: ${socket.id}`)
    })
  })

  // Talk endpoint - show speech bubble with TTS
  fastify.post<{ Body: { message: string; replyTo?: string } }>(
    '/crawd/talk',
    async (request, reply) => {
      const { message, replyTo } = request.body
      if (!message || typeof message !== 'string') {
        return reply.status(400).send({ error: 'message is required' })
      }

      // Emit message immediately
      io.emit('crawd:talk', { message, replyTo: replyTo ?? null })

      // Generate TTS in background
      generateTTSWithFallback(message)
        .then((ttsUrl) => {
          if (ttsUrl) {
            fastify.log.info({ ttsUrl }, 'TTS generated')
            io.emit('crawd:tts', { ttsUrl })
          }
        })
        .catch((e) => {
          fastify.log.error(e, 'Failed to generate TTS')
        })

      return { ok: true }
    }
  )

  // Notification endpoint
  fastify.post<{ Body: { body: string } }>(
    '/notification',
    async (request, reply) => {
      const { body } = request.body
      if (!body || typeof body !== 'string') {
        return reply.status(400).send({ error: 'body is required' })
      }

      const ttsUrl = await generateTTSWithFallback(body)
      io.emit('crawd:notification', { body, ttsUrl })
      return { ok: true }
    }
  )

  // Chat message endpoint (for testing/integration)
  fastify.post<{ Body: { username: string; message: string; platform?: string } }>(
    '/chat',
    async (request, reply) => {
      const { username, message, platform } = request.body
      if (!username || !message) {
        return reply.status(400).send({ error: 'username and message are required' })
      }

      const chatMsg = {
        id: randomUUID(),
        shortId: randomUUID().slice(0, 6),
        username,
        message,
        platform: platform ?? 'external',
        timestamp: Date.now(),
      }

      io.emit('crawd:chat', chatMsg)
      return { ok: true, id: chatMsg.id }
    }
  )

  // Health check
  fastify.get('/health', async () => {
    return { status: 'ok', tts: openai ? 'enabled' : 'disabled' }
  })

  const host = process.env.BIND_HOST || '0.0.0.0'
  await fastify.listen({ port, host })

  fastify.log.info(`CRAWD Backend running on http://${host}:${port}`)
}

main().catch((err) => {
  console.error('Failed to start backend:', err)
  process.exit(1)
})
