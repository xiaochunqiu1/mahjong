/**
 * 好友房对局语音会话（无 UI，挂载即连接）：
 * - 进入对局时挂载 → 自动 enterRoom（不推流,默认关麦）
 * - 远端音频默认自动播放（默认开喇叭）
 * - props 变化调 SDK:micOn=true → startLocalAudio / false → stopLocalAudio
 *                      speakerOn=false → muteAllRemoteAudio(true)
 * - 卸载 → leaveRoom + destroy
 * - 错误不影响对局，仅 console 警告
 */
import { useEffect, useRef } from 'react';
import { apiGetTrtcSign } from '../game/online.js';

// V5 SDK CDN
const TRTC_SDK_URL = 'https://cdn.jsdelivr.net/npm/trtc-sdk-v5@5.19.1/trtc.js';

let sdkPromise: Promise<any> | null = null;
function getTrtcSdk(): Promise<any> {
  if ((window as any).TRTC) return Promise.resolve((window as any).TRTC);
  if (!sdkPromise) {
    sdkPromise = new Promise<void>((resolve, reject) => {
      if (document.querySelector(`script[src="${TRTC_SDK_URL}"]`)) return resolve();
      const s = document.createElement('script');
      s.src = TRTC_SDK_URL;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('语音 SDK 加载失败'));
      document.head.appendChild(s);
    }).then(() => {
      if (!(window as any).TRTC) throw new Error('语音 SDK 初始化失败');
      return (window as any).TRTC;
    }).catch((e) => { sdkPromise = null; throw e; });
  }
  return sdkPromise;
}

export function VoiceSession({
  roomId, token, micOn, speakerOn,
}: {
  roomId: string; token: string; micOn: boolean; speakerOn: boolean;
}) {
  const trtcRef = useRef<any>(null);
  const readyRef = useRef(false);
  const speakerOnRef = useRef(speakerOn);
  const remoteUsersRef = useRef<Set<string>>(new Set());
  speakerOnRef.current = speakerOn;

  useEffect(() => {
    let cancelled = false;
    readyRef.current = false;
    (async () => {
      try {
        const sign = await apiGetTrtcSign(roomId, token);
        if (cancelled) return;
        const TRTC = await getTrtcSdk();
        if (cancelled) return;
        const trtc = TRTC.create({ sdkAppId: sign.sdkAppId, userId: sign.userId });
        trtcRef.current = trtc;
        const numericRoomId = Number(sign.trtcRoomId.split('_')[1] || sign.trtcRoomId);
        // 远端音频事件：记录 userId 并按当前喇叭状态静音/放音（v5 无 muteAllRemoteAudio，须逐个 muteRemoteAudio）
        trtc.on(TRTC.EVENT.REMOTE_AUDIO_AVAILABLE, (e: any) => {
          remoteUsersRef.current.add(e.userId);
          if (!speakerOnRef.current) {
            try { trtc.muteRemoteAudio(e.userId, true); } catch { /* ignore */ }
          }
        });
        trtc.on(TRTC.EVENT.REMOTE_AUDIO_UNMOUNTED, (e: any) => {
          remoteUsersRef.current.delete(e.userId);
        });
        await trtc.enterRoom({ roomId: numericRoomId, userId: sign.userId, userSig: sign.userSig, sdkAppId: sign.sdkAppId });
        if (cancelled) {
          trtc.exitRoom().catch(() => {}); trtc.destroy();
          return;
        }
        if (micOn) trtc.startLocalAudio().catch(() => {});
        readyRef.current = true;
      } catch (e) {
        console.warn('[VoiceSession] connect failed:', e);
      }
    })();
    return () => {
      cancelled = true;
      readyRef.current = false;
      remoteUsersRef.current.clear();
      const trtc = trtcRef.current;
      trtcRef.current = null;
      if (trtc) {
        try { trtc.stopLocalAudio().catch(() => {}); } catch { /* ignore */ }
        try { trtc.exitRoom().catch(() => {}); } catch { /* ignore */ }
        try { trtc.destroy(); } catch { /* ignore */ }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, token]);

  useEffect(() => {
    const trtc = trtcRef.current;
    if (!trtc || !readyRef.current) return;
    try {
      if (micOn) trtc.startLocalAudio().catch(() => {});
      else trtc.stopLocalAudio().catch(() => {});
    } catch (e) { console.warn('[VoiceSession] mic toggle failed:', e); }
  }, [micOn]);

  useEffect(() => {
    const trtc = trtcRef.current;
    if (!trtc || !readyRef.current) return;
    // 逐个对已知远端用户静音/放音
    remoteUsersRef.current.forEach((uid) => {
      try { trtc.muteRemoteAudio(uid, !speakerOn); } catch (e) { console.warn('[VoiceSession] speaker toggle failed:', e); }
    });
  }, [speakerOn]);

  return null;
}