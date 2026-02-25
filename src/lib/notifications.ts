/**
 * GO Signal notification utilities: browser sound + push notification.
 */

// ---------------------------------------------------------------------------
// 1. Sound – synthesised alert tone via Web Audio API (no file needed)
// ---------------------------------------------------------------------------

let audioCtx: AudioContext | null = null;

function getAudioCtx(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  return audioCtx;
}

/** Play a short ascending two-tone alert. */
export function playGoAlert() {
  try {
    const ctx = getAudioCtx();
    const now = ctx.currentTime;

    const playTone = (freq: number, start: number, dur: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.25, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + dur);
    };

    playTone(880, now, 0.15);       // A5
    playTone(1174.66, now + 0.15, 0.2); // D6
  } catch {
    // Silently fail – audio may be blocked
  }
}

// ---------------------------------------------------------------------------
// 2. Browser Push Notification (Notification API)
// ---------------------------------------------------------------------------

/** Request notification permission (should be called on user gesture). */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  return result === "granted";
}

/** Show a browser notification for a GO signal. Returns true if shown. */
export function showGoNotification(
  subnetName: string,
  netuid: number,
  score: number | null
): boolean {
  if (!("Notification" in window) || Notification.permission !== "granted") return false;

  const body = score != null
    ? `Score ${score} — ${subnetName || `SN-${netuid}`}`
    : subnetName || `SN-${netuid}`;

  const n = new Notification("🚀 GO Signal Fired", {
    body,
    icon: "/favicon.ico",
    tag: `go-signal-${netuid}`, // dedup by subnet
    requireInteraction: false,
  });

  // Focus tab on click
  n.onclick = () => {
    window.focus();
    n.close();
  };

  return true;
}
