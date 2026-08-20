/**
 * 房间内声音状态全局 store（大厅 Room + 对局 OnlineGame 共享）：
 * 设置一次，两边都生效；进入对局时从 localStorage 读最新值，无需重新设置。
 * 通道：mic(麦克风/TRTC 推流)、speaker(其他玩家/TRTC 拉流)
 * 注意：sfx/bgm 走 sound.ts 全局（已是 App 级），这里只管对局相关。
 */
const KEY_MIC = 'qz-mj-voice-mic';
const KEY_SPEAKER = 'qz-mj-voice-speaker';
const EVT = 'voice-change';

function read(key: string, defaultVal: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    if (v === null) return defaultVal;
    return v !== '0';
  } catch { return defaultVal; }
}
function write(key: string, on: boolean) {
  try { localStorage.setItem(key, on ? '1' : '0'); } catch { /* ignore */ }
  // 同 tab 内 localStorage 'storage' 事件不触发，用自定义事件广播
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVT));
}

export function isMicOn(): boolean { return read(KEY_MIC, false); }     // 麦克风默认关
export function isSpeakerOn(): boolean { return read(KEY_SPEAKER, true); } // 喇叭默认开

export function setMicOn(on: boolean) { write(KEY_MIC, on); }
export function setSpeakerOn(on: boolean) { write(KEY_SPEAKER, on); }

export function onVoiceChange(handler: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(EVT, handler);
  return () => window.removeEventListener(EVT, handler);
}
