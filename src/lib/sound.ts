export type NotificationSoundKind = 'new_lead' | 'action' | 'alert';

const SOUND_PREF_KEY = 'leadflow_notification_sound';
let sharedAudioCtx: AudioContext | null = null;
const playedSoundIds = new Set<string>();
let unlockAttached = false;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  if (!sharedAudioCtx) {
    sharedAudioCtx = new Ctx();
  }
  return sharedAudioCtx;
}

export function isNotificationSoundEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const val = window.localStorage.getItem(SOUND_PREF_KEY);
    return val === null ? true : val === 'true';
  } catch {
    return true;
  }
}

export function setNotificationSoundEnabled(enabled: boolean) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SOUND_PREF_KEY, enabled ? 'true' : 'false');
  } catch {
    // ignore storage errors
  }
}

export function attachAudioUnlockListeners() {
  if (typeof window === 'undefined' || unlockAttached) return;
  unlockAttached = true;

  const unlock = () => {
    const ctx = getAudioContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
  };

  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('keydown', unlock, { passive: true });
}

export function classifyNotificationSoundKind(type?: string | null): NotificationSoundKind {
  if (!type) return 'action';
  if (type === 'new_lead' || type === 'lead_converted') return 'new_lead';
  if (type === 'integration_failed') return 'alert';
  return 'action';
}

function scheduleTone(
  ctx: AudioContext,
  startTime: number,
  freq: number,
  duration: number,
  peakGain: number,
  wave: OscillatorType = 'sine'
) {
  const osc = ctx.createOscillator();
  const harmonic = ctx.createOscillator();
  const gain = ctx.createGain();
  const harmonicGain = ctx.createGain();

  osc.type = wave;
  osc.frequency.setValueAtTime(freq, startTime);

  harmonic.type = 'sine';
  harmonic.frequency.setValueAtTime(freq * 2, startTime);

  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(peakGain, startTime + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

  harmonicGain.gain.setValueAtTime(0.0001, startTime);
  harmonicGain.gain.exponentialRampToValueAtTime(peakGain * 0.22, startTime + 0.012);
  harmonicGain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration * 0.7);

  osc.connect(gain);
  harmonic.connect(harmonicGain);
  harmonicGain.connect(gain);
  gain.connect(ctx.destination);

  osc.start(startTime);
  harmonic.start(startTime);
  osc.stop(startTime + duration + 0.02);
  harmonic.stop(startTime + duration + 0.02);
}

/**
 * Plays a distinctive studio-synthesized chime via Web Audio API:
 * - 'new_lead': bright 3-note ascending crystal chord (C5 -> E5 -> G5 -> C6)
 * - 'action': clean 2-note executive chime (G5 -> B5)
 * - 'alert': warm low double tone (E4 -> C4)
 */
export async function playNotificationSound(kind: NotificationSoundKind = 'action', dedupeId?: string): Promise<boolean> {
  if (!isNotificationSoundEnabled()) return false;

  if (dedupeId) {
    if (playedSoundIds.has(dedupeId)) return false;
    playedSoundIds.add(dedupeId);
    if (playedSoundIds.size > 300) {
      const oldest = playedSoundIds.values().next().value;
      if (oldest) playedSoundIds.delete(oldest);
    }
  }

  const ctx = getAudioContext();
  if (!ctx) return false;

  if (ctx.state === 'suspended') {
    try {
      await ctx.resume();
    } catch {
      return false;
    }
  }

  if (ctx.state !== 'running') return false;

  const now = ctx.currentTime + 0.01;

  if (kind === 'new_lead') {
    // Crisp celebratory ascending chime for new leads / conversions
    scheduleTone(ctx, now, 523.25, 0.24, 0.16, 'triangle'); // C5
    scheduleTone(ctx, now + 0.09, 659.25, 0.26, 0.17, 'sine'); // E5
    scheduleTone(ctx, now + 0.18, 783.99, 0.3, 0.18, 'sine'); // G5
    scheduleTone(ctx, now + 0.27, 1046.5, 0.48, 0.19, 'sine'); // C6
  } else if (kind === 'alert') {
    scheduleTone(ctx, now, 392.0, 0.22, 0.15, 'triangle'); // G4
    scheduleTone(ctx, now + 0.14, 329.63, 0.34, 0.15, 'triangle'); // E4
  } else {
    // Distinct crisp executive chime for CRM actions (status, note, follow-up, assign)
    scheduleTone(ctx, now, 783.99, 0.22, 0.15, 'sine'); // G5
    scheduleTone(ctx, now + 0.11, 987.77, 0.36, 0.17, 'sine'); // B5
  }

  return true;
}
