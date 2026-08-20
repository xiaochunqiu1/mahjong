/**
 * 音效 + 简易 BGM（纯 Web Audio API 合成，无音频文件依赖）。
 *
 * 设计目标：
 * - 出牌、摸牌等不再播放"滴滴"短促音，避免噪声干扰
 * - TTS（浏览器内置）朗读牌名（如「八筒」「三万」）+ 动作（碰/杠/胡/单游/双游）
 * - 失败时的"候选音"：用柔和的纯音/和弦让操作有反馈，但不像早期版本的"滴滴"
 * - BGM：基于五声音阶（宫商角徵羽）的 8 小节循环，60 BPM，节奏轻快
 *
 * 浏览器需用户交互后才能播放 AudioContext / speechSynthesis。
 */

let ctx: AudioContext | null = null;
let sfxEnabled = true;
let bgmEnabled = false;
let bgmStop: (() => void) | null = null;
let speechVoice: SpeechSynthesisVoice | null = null;
let ttsReady = false; // iOS/微信：speak 必须在 user gesture 内预热一次才生效

/** 用户首次交互时调用：预热 speechSynthesis（iOS Safari/微信限制：非手势 speak 被忽略） */
export function unlockTTS() {
  if (typeof window === 'undefined' || !window.speechSynthesis || ttsReady) return;
  ttsReady = true;
  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    window.speechSynthesis.speak(u);
  } catch { /* ignore */ }
}

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

/** 柔和短音（替代早期出牌的"滴滴"） */
function pip(freq: number, dur: number, type: OscillatorType = 'sine', gain = 0.12) {
  if (!sfxEnabled) return;
  const c = getCtx();
  if (!c) return;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, c.currentTime);
  g.gain.setValueAtTime(0, c.currentTime);
  g.gain.linearRampToValueAtTime(gain, c.currentTime + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
  osc.connect(g).connect(c.destination);
  osc.start();
  osc.stop(c.currentTime + dur + 0.02);
}

/** 导出：让 UI 在"按胡按钮"等手势上下文内立即触发胡牌音效（不等异步播报） */
export function chord(freqs: number[], dur: number, gain = 0.10) {
  freqs.forEach((f) => pip(f, dur, 'triangle', gain));
}

/** 选一个中文 TTS voice（首次调用时挑一个存住；部分浏览器 getVoices 异步，监听 voiceschanged 兜底） */
function pickZhVoice(): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined' || !window.speechSynthesis) return null;
  if (speechVoice) return speechVoice;
  const find = () => {
    const voices = window.speechSynthesis.getVoices();
    return voices.find((v) => /zh|chinese|mandarin/i.test(v.lang) || /chinese|mandarin/i.test(v.name)) ?? null;
  };
  const zh = find();
  if (zh) speechVoice = zh;
  // 部分浏览器首次 getVoices 为空，监听 voiceschanged 后重取
  if (!zh && !window.speechSynthesis.onvoiceschanged) {
    window.speechSynthesis.onvoiceschanged = () => {
      const v = find();
      if (v) speechVoice = v;
    };
  }
  return speechVoice;
}

/** 云函数 TTS 播放（百度合成，微信/旧浏览器无 speechSynthesis 时的兜底） */
const cloudTtsCache = new Map<string, HTMLAudioElement>();
// TTS 音频缓冲缓存（mp3 → AudioBuffer）—— 用 Web Audio API 解决 HTMLAudio autoplay 拦截问题
const ttsBufferCache = new Map<string, AudioBuffer>();
const ttsLoading = new Map<string, Promise<AudioBuffer | null>>();

function loadTtsBuffer(text: string): Promise<AudioBuffer | null> {
  if (ttsBufferCache.has(text)) return Promise.resolve(ttsBufferCache.get(text)!);
  if (ttsLoading.has(text)) return ttsLoading.get(text)!;
  const env = (import.meta as any).env ?? {};
  const base: string = env.VITE_TCB_URL ?? '';
  if (!base) return Promise.resolve(null);
  const url = base.replace(/\/room-api$/, '/tts-api') + '?text=' + encodeURIComponent(text);
  const p = (async () => {
    try {
      const c = getCtx();
      if (!c) return null;
      const res = await fetch(url);
      if (!res.ok) return null;
      const ab = await res.arrayBuffer();
      const buf = await c.decodeAudioData(ab);
      ttsBufferCache.set(text, buf);
      return buf;
    } catch { return null; }
    finally { ttsLoading.delete(text); }
  })();
  ttsLoading.set(text, p);
  return p;
}

/** 预热常用 TTS 文本（开局点按钮时调用）——避免首次出牌延迟 */
export async function preloadTtsBuffers(texts: string[]): Promise<void> {
  await Promise.all(texts.map((t) => loadTtsBuffer(t)));
}

/** 云函数 TTS 播放——AudioContext 模式解锁后跨浏览器+微信统一男声 */
function playCloudTts(text: string) {
  if (typeof window === 'undefined') return;
  const c = getCtx();
  if (!c) return;
  loadTtsBuffer(text).then((buf) => {
    if (!buf) return;
    try {
      const src = c.createBufferSource();
      src.buffer = buf;
      const gain = c.createGain();
      gain.gain.value = 0.9;
      src.connect(gain).connect(c.destination);
      src.start(0);
    } catch { /* ignore */ }
  });
}

/** 短时间去重：同一文本 1.5s 内不重复播报（防止"自己出牌"被同步+异步双触发播两次） */
let lastSpeak = { text: '', at: 0 };

/** 内部播报：跳过去重（用于"白板"等拼接两段朗读，避免被 1.5s 去重拦截第二段） */
function speakNoDedup(text: string) {
  if (!sfxEnabled || typeof window === 'undefined') return;
  const env = (import.meta as any).env ?? {};
  const base: string = env.VITE_TCB_URL ?? '';
  if (base) { playCloudTts(text); return; }
  const canBrowserTts = !!window.speechSynthesis && ttsReady;
  if (canBrowserTts) {
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'zh-CN';
      u.rate = 1.55;
      u.pitch = 1.15;
      u.volume = 0.9;
      const voice = pickZhVoice();
      if (voice) u.voice = voice;
      window.speechSynthesis.speak(u);
    } catch { /* ignore */ }
  }
}

/** 朗读中文短句：云函数百度 TTS 优先（统一度阿闽男声）；云函数不可用 → 浏览器 TTS 兜底
 *  ABB 类词（如"白板"）拆成两段朗读，确保两个音节都出声（百度 TTS 偶发只读首字） */
export function speak(text: string) {
  if (!sfxEnabled || typeof window === 'undefined') return;
  const now = Date.now();
  if (text === lastSpeak.text && now - lastSpeak.at < 1500) return;
  lastSpeak.text = text;
  lastSpeak.at = now;
  if (text === '白板') {
    speakNoDedup('白');
    window.setTimeout(() => speakNoDedup('板'), 260);
    return;
  }
  speakNoDedup(text);
}

/** 牌名 → 友好念法（东南西北带"风"，白板只喊"白"） */
export const tileSpeech = (kind: number): string => {
  const digits = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const honors = ['东风', '南风', '西风', '北风', '中', '发', '白'];
  if (kind < 9) return (digits[kind] ?? '') + '万';
  if (kind < 18) return (digits[kind - 9] ?? '') + '条';
  if (kind < 27) return (digits[kind - 18] ?? '') + '筒';
  return honors[kind - 27] ?? '';
};

/** 同步朗读一张牌（用于用户手势事件内，避免异步后被浏览器/微信拦截） */
export function speakTile(kind: number) {
  const text = tileSpeech(kind);
  if (text) speak(text);
}

export function setSoundEnabled(on: boolean) {
  sfxEnabled = on;
  if (on) { getCtx(); }
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    if (!on) window.speechSynthesis.cancel();
  }
  // 不再"关音效联动关背景乐"——音效/背景乐是两个独立开关（用户 2026-08-19 实测反馈）
}

export function isSoundEnabled() { return sfxEnabled; }

/** 候选音（柔和）—— 替代早期版的所有短促 beep */
function softPing(freq: number) { pip(freq, 0.18, 'sine', 0.10); }

/** 引擎牌名 → 念法（东南西北补"风"，与 tileSpeech 一致；白板念"白"） */
const WIND_SPEECH: Record<string, string> = { '东': '东风', '南': '南风', '西': '西风', '北': '北风', '白板': '白' };

/** 根据引擎日志播放音效 + TTS 朗读 */
export function playForEvent(log: string) {
  if (!sfxEnabled) return;
  const parts = log.split(':');
  // 引擎 log 形如 "出牌:seatN:kindName" → parts[2] 直接是中文牌名（如"八筒"），不要再 parseInt
  const tileName = parts[2] ?? '';

  if (log.startsWith('出牌:')) {
    // 出牌：柔和短音（取代"滴滴"）+ 喊牌名（同步调，不 setTimeout——避免脱离手势上下文导致微信 autoplay 拦截）
    softPing(620);
    if (tileName) speak(WIND_SPEECH[tileName] ?? tileName);
  } else if (log.startsWith('摸牌:')) {
    // 摸牌：低频轻音
    softPing(440);
  } else if (log.startsWith('碰:')) {
    chord([523, 784], 0.22, 0.14);
    speak('碰');
  } else if (log.startsWith('吃:')) {
    chord([587, 880], 0.22, 0.14);
    speak('吃');
  } else if (log.startsWith('明杠:') || log.startsWith('暗杠:') || log.startsWith('加杠:')) {
    chord([523, 659, 880], 0.28, 0.13);
    speak('杠');
  } else if (log.startsWith('单游宣告:')) {
    chord([523, 659, 880, 1047], 0.4, 0.13);
    speak('单游');
  } else if (log.startsWith('双游宣告:')) {
    chord([659, 880, 1047, 1319], 0.45, 0.13);
    speak('双游');
  } else if (log.startsWith('胡牌:')) {
    const wt = parts[2] ?? '';
    if (wt === 'danyou' || wt === 'shuangyou' || wt === 'sanyou') {
      // 游金胡：华丽上行琶音（不 speak——"X 游金你最棒！"由父组件延迟 600ms 喊，避免重叠）
      chord([523, 659, 784], 0.16, 0.12);
      setTimeout(() => chord([784, 988, 1175], 0.18, 0.12), 150);
      setTimeout(() => chord([1175, 1319, 1568], 0.30, 0.14), 320);
    } else {
      chord([523, 659], 0.18, 0.14);
      setTimeout(() => chord([784, 1047], 0.20, 0.13), 120);
      setTimeout(() => chord([1047, 1319], 0.30, 0.14), 260);
      speak('胡啦');
    }
  } else if (log.startsWith('流局')) {
    pip(220, 0.6, 'sine', 0.10, );
  }
}

/** 用 lastEvent 文案触发声音（联机视图用；引擎 log 用 playForEvent）
 *  文案示例："甲 打出 八筒"、"碰"、"杠"、"甲 胡牌 +27"、"对局开始！"、"阿美 宣告双游" */
export function triggerFromEvent(text: string) {
  if (!sfxEnabled || !text) return;
  // 同步调 speak（不 setTimeout）——避免脱离手势上下文导致微信/移动浏览器拦截 HTMLAudio.play()
  if (text.includes('打出')) {
    softPing(620);
    const m = text.match(/打出\s+(.+)$/);
    if (m && m[1]) speak(WIND_SPEECH[m[1]] ?? m[1]);
  } else if (text.includes('碰')) {
    chord([523, 784], 0.22, 0.14);
    speak('碰');
  } else if (text.includes('吃')) {
    chord([587, 880], 0.22, 0.14);
    speak('吃');
  } else if (text.includes('杠')) {
    chord([523, 659, 880], 0.28, 0.13);
    speak('杠');
  } else if (text.includes('游')) {
    // 游金：宣告 vs 游金自摸，都要比普通动作更华丽的祝贺（自摸的喊话由父组件延迟喊，避免与"游"系列音效重叠）
    if (text.includes('自摸')) {
      chord([523, 659, 784], 0.16, 0.12);
      setTimeout(() => chord([784, 988, 1175], 0.18, 0.12), 150);
      setTimeout(() => chord([1175, 1319, 1568], 0.30, 0.14), 320);
    } else {
      chord([659, 880], 0.16, 0.12);
      setTimeout(() => chord([988, 1175], 0.22, 0.13), 130);
      speak(text.includes('双游') ? '双游' : '单游');
    }
  } else if (text.includes('胡')) {
    chord([523, 659], 0.18, 0.14);
    setTimeout(() => chord([784, 1047], 0.20, 0.13), 120);
    setTimeout(() => chord([1047, 1319], 0.30, 0.14), 260);
    speak('胡啦');
  } else if (text.includes('双游')) {
    chord([659, 880, 1047, 1319], 0.45, 0.13);
    speak('双游');
  } else if (text.includes('单游')) {
    chord([523, 659, 880, 1047], 0.4, 0.13);
    speak('单游');
  }
}

// ---- 背景音乐：优先播放 public/bgm.mp3（HTML5 Audio 循环），无文件时 fallback 合成循环

let bgmAudio: HTMLAudioElement | null = null;
let bgmFallbackStop: (() => void) | null = null;

/** 启动 / 停止 BGM（默认关，用户开） */
export function setBgmEnabled(on: boolean) {
  bgmEnabled = on;
  setBgmStore(on);
  if (on) {
    setSoundEnabled(true);
    if (!bgmStop) bgmStop = startBgm();
  } else if (bgmStop) {
    bgmStop(); bgmStop = null;
  }
}

// ---- 页面关闭/切走时强制停止所有音频（iOS/部分浏览器 audio 卸载页面不会自动暂停）----
export function stopAllAudio() {
  if (bgmAudio) {
    try { bgmAudio.pause(); bgmAudio.currentTime = 0; } catch {}
    bgmAudio = null;
  }
  if (bgmFallbackStop) { bgmFallbackStop(); bgmFallbackStop = null; }
  if (bgmStop) { bgmStop(); bgmStop = null; }
  if (ctx) {
    try { ctx.close(); } catch {}
    ctx = null;
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', stopAllAudio);
  window.addEventListener('beforeunload', stopAllAudio);
}

export function isBgmEnabled() { return bgmEnabled; }

/** BGM 开关持久化 + 事件广播（与 voice.ts 同模式：所有读写都走这里） */
const KEY_BGM = 'qz-mj-bgm';
function readBgm(): boolean {
  try { const v = localStorage.getItem(KEY_BGM); return v === null ? true : v !== '0'; } catch { return true; }
}
export function getBgm(): boolean { return readBgm(); }
export function setBgmStore(on: boolean) {
  try { localStorage.setItem(KEY_BGM, on ? '1' : '0'); } catch { /* ignore */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('bgm-change'));
}

/** 调试：window.__bgmDebug() 返回当前 BGM 音频真实状态（验证用，无害保留） */
if (typeof window !== 'undefined') {
  (window as any).__bgmDebug = () => {
    const a = bgmAudio;
    return {
      enabled: bgmEnabled,
      hasAudio: !!a,
      paused: a ? a.paused : null,
      muted: a ? a.muted : null,
      readyState: a ? a.readyState : null,
      currentTime: a ? +a.currentTime.toFixed(2) : null,
    };
  };
}

/** midi 音符 → 频率 Hz */
function midiHz(n: number) { return 440 * Math.pow(2, (n - 69) / 12); }

/** 启动 BGM：直接播放 mp3 文件；mobile 自动播放限制用 muted-play 解锁
 *  微信 X5 特例：页面加载时创建的 Audio 会被锁定（play 永远被拒）；用户交互后「新建」的 Audio 才允许播放
 *  → 手势内旧 Audio 失败时，当场新建一个 Audio 直接播放（gesture 上下文内新建，微信放行） */
function startBgm(): () => void {
  if (typeof window === 'undefined') return () => {};
  const a = new Audio('/bgm.mp3');
  a.loop = true;
  a.volume = 0.7;
  a.preload = 'auto';
  // mobile 上先 muted play（autoplay 通常允许），成功后再 unmute
  a.muted = true;
  /** 尝试恢复音量+播放；成功返回 true，失败保持 muted 并返回 false（监听器保留，下次交互重试） */
  const tryUnmute = (): Promise<boolean> => {
    if (!a.muted) return Promise.resolve(true);
    a.muted = false;
    const p = a.play();
    if (p && typeof p.then === 'function') {
      return p.then(() => { a.muted = false; return true; }).catch(() => { a.muted = true; return false; });
    }
    a.muted = true;
    return Promise.resolve(false);
  };
  void a.play().catch(() => { /* autoplay 被屏蔽：保持静音，等用户后续交互 */ });
  // 激进恢复：5 秒内每 500ms 重试 unmute——浏览器一旦允许（任何手势/切前台）立即出声
  const retryIv = window.setInterval(() => {
    if (!bgmAudio || bgmAudio !== a) { window.clearInterval(retryIv); return; }
    if (!a.paused && a.muted) void tryUnmute();
  }, 500);
  window.setTimeout(() => window.clearInterval(retryIv), 5000);
  // 微信内置浏览器：WeixinJSBridge ready 后可绕过 autoplay 限制自动播放（微信官方机制）
  const wxAutoPlay = () => {
    try {
      const wb = (window as any).WeixinJSBridge;
      if (wb) wb.invoke('getNetworkType', {}, () => { a.muted = false; void a.play().catch(() => {}); });
    } catch { /* ignore */ }
  };
  document.addEventListener('WeixinJSBridgeReady', wxAutoPlay, false);
  if ((window as any).WeixinJSBridge) wxAutoPlay();
  // 任何用户手势都尝试恢复；失败不移除监听（手机浏览器首次 touch 可能被拒，后续 touchend/click 再试）
  const EVT_NAMES = ['touchstart', 'touchend', 'pointerdown', 'mousedown', 'click', 'keydown'] as const;
  const tryPlay = (audio: HTMLAudioElement) => {
    audio.muted = false;
    try {
      const p = audio.play();
      if (p && typeof p.catch === 'function') p.catch(() => { audio.muted = true; });
    } catch { /* ignore */ }
  };
  /** 手势内新建 Audio 直接播放（微信 X5：交互时新建的 audio 放行，与"点音乐开关能响"机制一致）；
   *  用 setTimeout + paused 判断播放结果（不依赖 play() 返回的 promise——微信 X5 可能返回 undefined） */
  const tryRebuild = () => {
    if (bgmAudio !== a) return;
    const a2 = new Audio('/bgm.mp3');
    a2.loop = true;
    a2.volume = 0.7;
    a2.preload = 'auto';
    tryPlay(a2);
    window.setTimeout(() => {
      if (bgmAudio === a && !a2.paused) {
        try { a.pause(); } catch { /* ignore */ }
        bgmAudio = a2;
        EVT_NAMES.forEach((n) => window.removeEventListener(n, onInteract));
      } else {
        try { a2.pause(); } catch { /* ignore */ } // 没播起来，下次交互再试
      }
    }, 300);
  };
  const onInteract = () => {
    if (bgmAudio !== a) return;
    // 先试旧 audio（电脑/手机系统浏览器路径：手势内 unmute play 直接成功）
    tryPlay(a);
    // 若旧 audio 仍未在播（微信 X5 锁定页面加载期创建的 Audio）→ 手势内新建 audio 直接播放
    if (a.paused) tryRebuild();
  };
  EVT_NAMES.forEach((n) => window.addEventListener(n, onInteract));
  // 页面切回前台时也尝试（实测：手机系统浏览器息屏开屏后能成功解锁）
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void tryUnmute(); });
  bgmAudio = a;
  return () => {
    document.removeEventListener('WeixinJSBridgeReady', wxAutoPlay, false);
    window.clearInterval(retryIv);
    EVT_NAMES.forEach((n) => window.removeEventListener(n, onInteract));
    if (bgmAudio) { try { bgmAudio.pause(); bgmAudio.currentTime = 0; } catch {} bgmAudio = null; }
    if (bgmFallbackStop) { bgmFallbackStop(); bgmFallbackStop = null; }
  };
}

/** 合成版 BGM（Web Audio，无文件时的保底） */
function startSynthBgm(): () => void {
  const c = getCtx();
  if (!c) return () => {};
  const BPM = 80;
  const beat = 60 / BPM;
  const melody = [
    60, 64, 67, 64, 62, 60, 57, 60,
    64, 67, 69, 67, 64, 62, 60, 57,
    55, 57, 60, 62, 64, 60, 57, 55,
    60, 64, 67, 72, 69, 67, 64, 60,
  ];
  const drumPattern = [1, 0, 2, 0, 1, 0, 1, 2];
  const chords = [
    [60 - 12, 64 - 12, 67 - 12],
    [62 - 12, 65 - 12, 69 - 12],
    [64 - 12, 67 - 12, 71 - 12],
    [65 - 12, 69 - 12, 72 - 12],
  ];

  const masterGain = c.createGain();
  masterGain.gain.value = 0.28;
  masterGain.connect(c.destination);

  const melodyGain = c.createGain();
  melodyGain.gain.value = 0.40;

  const bassGain = c.createGain();
  bassGain.gain.value = 0.30;
  bassGain.connect(masterGain);

  const drumGain = c.createGain();
  drumGain.gain.value = 0.45;
  drumGain.connect(masterGain);

  const lowpass = c.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 3200;
  melodyGain.connect(lowpass).connect(masterGain);

  let stopped = false;
  let step = 0;
  let timer = null;
  let nextTime = c.currentTime + 0.08;

  function playStep(at: number, idx: number) {
    const ctx = c;
    if (!ctx) return;
    const note = melody[idx % melody.length] || 60;
    const beat4 = idx % 4;
    const chordRoot = (chords[beat4] && chords[beat4][0]) || 48;

    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = midiHz(note);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(0.08, at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, at + beat * 0.9);
    osc.connect(g).connect(melodyGain);
    osc.start(at);
    osc.stop(at + beat + 0.05);

    if (idx % 2 === 1) {
      const d = ctx.createOscillator();
      const dg = ctx.createGain();
      d.type = 'sine';
      d.frequency.value = midiHz(note + 12);
      dg.gain.setValueAtTime(0, at + beat * 0.5);
      dg.gain.linearRampToValueAtTime(0.05, at + beat * 0.55);
      dg.gain.exponentialRampToValueAtTime(0.0001, at + beat * 0.9);
      d.connect(dg).connect(melodyGain);
      d.start(at + beat * 0.5);
      d.stop(at + beat + 0.02);
    }

    const b1 = ctx.createOscillator();
    const b2 = ctx.createOscillator();
    const bg = ctx.createGain();
    b1.type = 'sawtooth';
    b1.frequency.value = midiHz(chordRoot);
    b2.type = 'sawtooth';
    b2.frequency.value = midiHz(chordRoot + 7);
    bg.gain.setValueAtTime(0, at);
    bg.gain.linearRampToValueAtTime(0.10, at + 0.04);
    bg.gain.exponentialRampToValueAtTime(0.0001, at + beat * 0.95);
    b1.connect(bg); b2.connect(bg); bg.connect(bassGain);
    b1.start(at); b2.start(at);
    b1.stop(at + beat + 0.05); b2.stop(at + beat + 0.05);

    const drumHit = drumPattern[idx % drumPattern.length];
    if (drumHit === 1) {
      const k = ctx.createOscillator();
      const kg = ctx.createGain();
      k.type = 'sine';
      k.frequency.setValueAtTime(140, at);
      k.frequency.exponentialRampToValueAtTime(38, at + 0.10);
      kg.gain.setValueAtTime(0.30, at);
      kg.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
      k.connect(kg).connect(drumGain);
      k.start(at); k.stop(at + 0.20);
    } else if (drumHit === 2) {
      const ss = ctx.createOscillator();
      const sg = ctx.createGain();
      ss.type = 'square';
      ss.frequency.setValueAtTime(220, at);
      ss.frequency.exponentialRampToValueAtTime(110, at + 0.05);
      sg.gain.setValueAtTime(0.15, at);
      sg.gain.exponentialRampToValueAtTime(0.0001, at + 0.10);
      ss.connect(sg).connect(drumGain);
      ss.start(at); ss.stop(at + 0.13);
    }
    const h = ctx.createOscillator();
    const hg = ctx.createGain();
    h.type = 'square';
    h.frequency.value = 8000;
    hg.gain.setValueAtTime(0.04, at);
    hg.gain.exponentialRampToValueAtTime(0.0001, at + 0.04);
    h.connect(hg).connect(drumGain);
    h.start(at); h.stop(at + 0.05);
  }

  function scheduler() {
    if (stopped || !c) return;
    while (nextTime < c.currentTime + 0.5) {
      playStep(nextTime, step);
      nextTime += beat;
      step++;
    }
  }

  timer = window.setInterval(scheduler, 80);
  scheduler();

  return () => {
    stopped = true;
    if (timer !== null) window.clearInterval(timer);
    try { masterGain.disconnect(); } catch {}
  };
}