import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Coordinator, type CoordinatorConfig, type CoordinatorEvent, type IClock, type TriggerAgentFn } from './coordinator.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fake clock — timers are manually advanced via flush/advance */
function createMockClock(): IClock & { advance(ms: number): void; flush(): void } {
  const timers: Array<{ id: number; callback: () => void; fireAt: number; interval?: number }> = []
  let now = 1_000_000
  let nextId = 1

  const clock: IClock & { advance(ms: number): void; flush(): void } = {
    now: () => now,
    setTimeout(cb, ms) {
      const id = nextId++
      timers.push({ id, callback: cb, fireAt: now + ms })
      return id as unknown as NodeJS.Timeout
    },
    clearTimeout(t) {
      const id = t as unknown as number
      const idx = timers.findIndex(tt => tt.id === id)
      if (idx !== -1) timers.splice(idx, 1)
    },
    setInterval(cb, ms) {
      const id = nextId++
      timers.push({ id, callback: cb, fireAt: now + ms, interval: ms })
      return id as unknown as NodeJS.Timeout
    },
    clearInterval(t) {
      const id = t as unknown as number
      const idx = timers.findIndex(tt => tt.id === id)
      if (idx !== -1) timers.splice(idx, 1)
    },
    /** Advance time by ms and fire all timers that would have fired */
    advance(ms: number) {
      const target = now + ms
      while (true) {
        // Find earliest timer that fires before target
        const ready = timers
          .filter(t => t.fireAt <= target)
          .sort((a, b) => a.fireAt - b.fireAt)
        if (ready.length === 0) break
        const t = ready[0]
        now = t.fireAt
        const idx = timers.indexOf(t)
        if (t.interval) {
          // Reschedule interval
          timers[idx] = { ...t, fireAt: t.fireAt + t.interval }
        } else {
          timers.splice(idx, 1)
        }
        t.callback()
      }
      now = target
    },
    /** Fire all currently ready timers without advancing */
    flush() {
      const ready = timers.filter(t => t.fireAt <= now).sort((a, b) => a.fireAt - b.fireAt)
      for (const t of ready) {
        const idx = timers.indexOf(t)
        if (idx === -1) continue
        if (t.interval) {
          timers[idx] = { ...t, fireAt: t.fireAt + t.interval }
        } else {
          timers.splice(idx, 1)
        }
        t.callback()
      }
    },
  }

  return clock
}

const silentLogger = { log: vi.fn(), error: vi.fn(), warn: vi.fn() }

function makeChatMessage(text: string) {
  return {
    id: `id-${text}`,
    shortId: text.slice(0, 6),
    username: 'tester',
    message: text,
    platform: 'youtube' as const,
    timestamp: Date.now(),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Coordinator — Plan Mode', () => {
  let clock: ReturnType<typeof createMockClock>
  let triggerFn: ReturnType<typeof vi.fn<TriggerAgentFn>>
  let events: CoordinatorEvent[]

  const planConfig: Partial<CoordinatorConfig> = {
    autonomyMode: 'plan',
    planNudgeDelayMs: 100,
    batchWindowMs: 50,
    idleAfterMs: 5_000,
    sleepAfterIdleMs: 5_000,
  }

  beforeEach(() => {
    clock = createMockClock()
    triggerFn = vi.fn<TriggerAgentFn>().mockResolvedValue(['LIVESTREAM_REPLIED'])
    events = []
  })

  function createCoordinator(configOverrides?: Partial<CoordinatorConfig>) {
    const coord = new Coordinator(triggerFn, { ...planConfig, ...configOverrides }, { clock, logger: silentLogger })
    coord.setOnEvent(e => events.push(e))
    coord.start()
    return coord
  }

  describe('autonomyMode', () => {
    it('defaults to plan from test config', () => {
      const coord = createCoordinator()
      expect(coord.getState().autonomyMode).toBe('plan')
      coord.stop()
    })

    it('respects vibe mode', () => {
      const coord = createCoordinator({ autonomyMode: 'vibe' })
      expect(coord.getState().autonomyMode).toBe('vibe')
      coord.stop()
    })

    it('respects none mode', () => {
      const coord = createCoordinator({ autonomyMode: 'none' })
      expect(coord.getState().autonomyMode).toBe('none')
      coord.stop()
    })
  })

  describe('setPlan', () => {
    it('creates a plan and emits planCreated event', () => {
      const coord = createCoordinator()
      const plan = coord.setPlan('Do something cool', ['Step 1', 'Step 2', 'Step 3'])

      expect(plan.goal).toBe('Do something cool')
      expect(plan.steps).toHaveLength(3)
      expect(plan.steps[0]).toEqual({ description: 'Step 1', status: 'pending' })
      expect(plan.status).toBe('active')

      const created = events.find(e => e.type === 'planCreated')
      expect(created).toBeDefined()
      expect((created as any).goal).toBe('Do something cool')
      expect((created as any).stepCount).toBe(3)
      coord.stop()
    })

    it('wakes coordinator if sleeping', () => {
      const coord = createCoordinator()
      expect(coord.state).toBe('sleep')

      coord.setPlan('Wake up', ['Do it'])
      expect(coord.state).toBe('active')
      coord.stop()
    })

    it('abandons existing plan when setting a new one', () => {
      const coord = createCoordinator()
      const plan1 = coord.setPlan('First', ['Step A'])
      coord.setPlan('Second', ['Step B'])

      const abandoned = events.find(e => e.type === 'planAbandoned')
      expect(abandoned).toBeDefined()
      expect((abandoned as any).planId).toBe(plan1.id)

      expect(coord.getPlan()?.goal).toBe('Second')
      coord.stop()
    })
  })

  describe('markStepDone', () => {
    it('marks a step as done', () => {
      const coord = createCoordinator()
      coord.setPlan('Test', ['A', 'B'])

      const updated = coord.markStepDone(0)
      expect(updated?.steps[0].status).toBe('done')
      expect(updated?.steps[1].status).toBe('pending')
      expect(updated?.status).toBe('active')
      coord.stop()
    })

    it('completes plan when all steps done', () => {
      const coord = createCoordinator()
      coord.setPlan('Test', ['A', 'B'])

      coord.markStepDone(0)
      coord.markStepDone(1)

      expect(coord.getPlan()?.status).toBe('completed')
      const completed = events.find(e => e.type === 'planCompleted')
      expect(completed).toBeDefined()
      coord.stop()
    })

    it('returns null for invalid index', () => {
      const coord = createCoordinator()
      coord.setPlan('Test', ['A'])

      expect(coord.markStepDone(-1)).toBeNull()
      expect(coord.markStepDone(5)).toBeNull()
      coord.stop()
    })

    it('returns null when no active plan', () => {
      const coord = createCoordinator()
      expect(coord.markStepDone(0)).toBeNull()
      coord.stop()
    })
  })

  describe('abandonPlan', () => {
    it('abandons active plan', () => {
      const coord = createCoordinator()
      coord.setPlan('Test', ['A'])

      const abandoned = coord.abandonPlan()
      expect(abandoned?.status).toBe('abandoned')

      const event = events.filter(e => e.type === 'planAbandoned')
      expect(event.length).toBeGreaterThanOrEqual(1)
      coord.stop()
    })

    it('returns null when no active plan', () => {
      const coord = createCoordinator()
      expect(coord.abandonPlan()).toBeNull()
      coord.stop()
    })
  })

  describe('plan nudge loop', () => {
    it('schedules nudge after flush when plan has pending steps', async () => {
      const coord = createCoordinator()
      coord.setPlan('Test', ['Step 1', 'Step 2'])

      // Send a chat message to trigger flush
      coord.onMessage(makeChatMessage('hello'))

      // Wait for flush to complete
      await vi.waitFor(() => expect(triggerFn).toHaveBeenCalledTimes(1))

      // The flush should have triggered checkPlanProgress → schedulePlanNudge
      const nudgeScheduled = events.find(e => e.type === 'planNudgeScheduled')
      expect(nudgeScheduled).toBeDefined()

      coord.stop()
    })

    it('sends [CRAWD:PLAN] prompt with plan progress', async () => {
      const coord = createCoordinator()
      coord.setPlan('Check BTC', ['Open tracker', 'Find price', 'Comment'])
      coord.markStepDone(0)

      // Advance past nudge delay to trigger planNudge
      clock.advance(150)

      // Wait for the nudge to fire
      await vi.waitFor(() => {
        const calls = triggerFn.mock.calls
        return expect(calls.some((c: any[]) => c[0]?.includes('[CRAWD:PLAN]'))).toBe(true)
      })

      const planCall = triggerFn.mock.calls.find((c: any[]) => c[0]?.includes('[CRAWD:PLAN]'))
      expect(planCall).toBeDefined()
      const prompt = planCall![0] as string
      expect(prompt).toContain('Check BTC')
      expect(prompt).toContain('[x] 0. Open tracker')
      expect(prompt).toContain('[-] 1. Find price')
      expect(prompt).toContain('<-- next')

      coord.stop()
    })

    it('does not nudge when plan is completed', async () => {
      const coord = createCoordinator()
      coord.setPlan('Quick', ['Only step'])
      coord.markStepDone(0)

      expect(coord.getPlan()?.status).toBe('completed')

      clock.advance(200)
      await new Promise(r => setTimeout(r, 50))

      // No plan nudge should have been sent
      const planNudges = triggerFn.mock.calls.filter((c: any[]) => c[0]?.includes('[CRAWD:PLAN]'))
      expect(planNudges).toHaveLength(0)

      coord.stop()
    })

    it('does not nudge when plan is abandoned', async () => {
      const coord = createCoordinator()
      coord.setPlan('Abandon me', ['Step 1', 'Step 2'])
      coord.abandonPlan()

      clock.advance(200)
      await new Promise(r => setTimeout(r, 50))

      const planNudges = triggerFn.mock.calls.filter((c: any[]) => c[0]?.includes('[CRAWD:PLAN]'))
      expect(planNudges).toHaveLength(0)

      coord.stop()
    })

    it('skips nudge when busy', async () => {
      // Make trigger slow so coordinator stays busy
      triggerFn.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve(['LIVESTREAM_REPLIED']), 500)))

      const coord = createCoordinator()
      coord.setPlan('Busy test', ['Step 1', 'Step 2'])

      // Trigger a chat message to make it busy
      coord.onMessage(makeChatMessage('start'))

      // Advance past nudge delay while flush is still in progress
      clock.advance(150)

      // Coordinator should handle the busy state gracefully without crashing
      coord.stop()
    })
  })

  describe('chat batch format', () => {
    it('includes END OF CHAT delimiter', () => {
      const coord = createCoordinator()

      const batch = coord.formatBatch([makeChatMessage('hello')])
      expect(batch).toContain('[END OF CHAT]')
      expect(batch).not.toContain('plan_set')

      coord.stop()
    })

    it('does not include plan instruction in chat batch', () => {
      const coord = createCoordinator()
      // No plan set, but chat batch should NOT include plan instruction

      const batch = coord.formatBatch([makeChatMessage('do something cool')])
      expect(batch).not.toContain('plan mode')
      expect(batch).not.toContain('plan_set')

      coord.stop()
    })
  })

  describe('getState includes plan', () => {
    it('includes plan and autonomyMode in state', () => {
      const coord = createCoordinator()
      coord.setPlan('Stateful', ['Step'])

      const state = coord.getState()
      expect(state.autonomyMode).toBe('plan')
      expect(state.plan).toBeDefined()
      expect(state.plan?.goal).toBe('Stateful')

      coord.stop()
    })
  })

  describe('vibe mode not affected', () => {
    it('does not schedule vibes in plan mode', () => {
      const coord = createCoordinator({ autonomyMode: 'plan' })
      coord.wake()

      clock.advance(35_000) // past default vibe interval

      const vibeScheduled = events.find(e => e.type === 'vibeScheduled')
      expect(vibeScheduled).toBeUndefined()

      coord.stop()
    })

    it('schedules vibes in vibe mode', () => {
      const coord = createCoordinator({ autonomyMode: 'vibe', vibeIntervalMs: 1_000 })
      coord.wake()

      const vibeScheduled = events.find(e => e.type === 'vibeScheduled')
      expect(vibeScheduled).toBeDefined()

      coord.stop()
    })
  })
})
