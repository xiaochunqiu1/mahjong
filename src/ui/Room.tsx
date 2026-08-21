import { useEffect, useRef, useState } from 'react';
import {
  apiCreateRoom, apiJoinRoom, apiSetReady, apiStartMatch, apiNextRound, apiLeaveRoom, apiPoll, apiSubmitAction,
  apiResumeSeat,
  type OnlineRoomView,
} from '../game/online.js';
import { OnlineGame } from './OnlineGame.js';
import { VoiceSession } from './VoiceSession.js';
import { SoundPanel } from './SoundPanel.js';
import { isMicOn, isSpeakerOn, setMicOn, setSpeakerOn, onVoiceChange } from '../game/voice.js';

interface Session {
  roomId: string;
  token: string;
  name: string;
}

const SEAT_NAMES = ['1 号位', '2 号位', '3 号位', '4 号位'];

export function Room({ go, mode }: { go: (p: string) => void; mode: 'create' | 'join' }) {
  // 身份 token 持久化在 localStorage：重进链接自动恢复原座位（不再变新身份卡"未准备"）
  const [session, setSession] = useState<Session | null>(() => {
    try {
      const s = localStorage.getItem('qz-mj-room');
      return s ? (JSON.parse(s) as Session) : null;
    } catch { return null; }
  });
  const [view, setView] = useState<OnlineRoomView | null>(null);
  const [name, setName] = useState<string>(() => localStorage.getItem('qz-mj-name') ?? '');
  const [roomIdInput, setRoomIdInput] = useState(() => {
    const q = new URLSearchParams(window.location.search).get('room');
    return q || '';
  });
  const [rounds, setRounds] = useState<4 | 8>(4);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState('');
  const copiedRoomRef = useRef(false);
  const resumeTriedRef = useRef(false);
  const [voiceMicOn, setVoiceMicOnState] = useState(isMicOn);        // 来自全局 store（大厅/对局共享）
  const [voiceSpeakerOn, setVoiceSpeakerOnState] = useState(isSpeakerOn);
  const [soundPanelOpen, setSoundPanelOpen] = useState(false);
  // 监听全局 voice 变化（对局里改 → 同步过来）
  useEffect(() => onVoiceChange(() => { setVoiceMicOnState(isMicOn()); setVoiceSpeakerOnState(isSpeakerOn()); }), []);
  const pollTimer = useRef<number | null>(null);
  const viewRef = useRef<OnlineRoomView | null>(null);
  viewRef.current = view;

  // 轮询房间状态（进入房间后每 1s）
  useEffect(() => {
    if (!session) return;
    const poll = async () => {
      try {
        const v = await apiPoll(session.roomId, session.token);
        setView(v);
      } catch { /* 网络波动忽略，下轮重试 */ }
    };
    poll();
    pollTimer.current = window.setInterval(poll, 1000);
    return () => { if (pollTimer.current) window.clearInterval(pollTimer.current); };
  }, [session]);

  // 方案2：重进链接时有旧 session → 自动 resumeSeat 恢复原座位（身份不丢）
  useEffect(() => {
    if (!session || resumeTriedRef.current) return;
    resumeTriedRef.current = true;
    apiResumeSeat(session.roomId, session.token)
      .then((v) => { setView(v); setErr(''); })
      .catch(() => {
        // 房间已解散/身份失效 → 清掉，正常显示表单
        try { localStorage.removeItem('qz-mj-room'); } catch { /* ignore */ }
        setSession(null);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 方案1：建房成功自动复制房间号到剪贴板
  useEffect(() => {
    if (view && session && !copiedRoomRef.current) {
      copiedRoomRef.current = true;
      copyText(session.roomId, '房间号已复制');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, session]);

  const copyText = (t: string, label: string) => {
    try {
      const done = () => { setCopied(label); window.setTimeout(() => setCopied(''), 2200); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(t).then(done).catch(() => fallbackCopy(t, done));
      } else fallbackCopy(t, done);
    } catch { setErr('复制失败，请手动抄录'); }
  };
  const fallbackCopy = (t: string, done: () => void) => {
    try {
      const ta = document.createElement('textarea');
      ta.value = t; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove();
      done();
    } catch { setErr('复制失败，请手动抄录'); }
  };

  const saveSession = (s: Session) => {
    setSession(s);
    try { localStorage.setItem('qz-mj-room', JSON.stringify(s)); } catch { /* ignore */ }
  };

  const doCreate = async () => {
    if (!name.trim()) { setErr('先填昵称'); return; }
    setBusy(true); setErr('');
    try {
      localStorage.setItem('qz-mj-name', name.trim());
      const r = await apiCreateRoom(name.trim(), rounds);
      saveSession({ roomId: r.roomId, token: r.token, name: name.trim() });
      setView(r.view);
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  const doJoin = async () => {
    if (!name.trim()) { setErr('先填昵称'); return; }
    if (!/^\d{4}$/.test(roomIdInput.trim())) { setErr('房间码是 4 位数字'); return; }
    setBusy(true); setErr('');
    try {
      localStorage.setItem('qz-mj-name', name.trim());
      const r = await apiJoinRoom(roomIdInput.trim(), name.trim());
      saveSession({ roomId: r.view.roomId, token: r.token, name: name.trim() });
      setView(r.view);
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  const toggleReady = async () => {
    if (!session || !view) return;
    const me = view.players.find((p) => p.seat === view.seat);
    if (!me) return;
    try {
      setView(await apiSetReady(session.roomId, session.token, !me.ready));
    } catch (e) { setErr((e as Error).message); }
  };

  const doStart = async () => {
    if (!session) return;
    setBusy(true); setErr('');
    try {
      setView(await apiStartMatch(session.roomId, session.token));
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  const doLeave = async () => {
    if (session) { try { await apiLeaveRoom(session.roomId, session.token); } catch { /* ignore */ } }
    try { localStorage.removeItem('qz-mj-room'); } catch { /* ignore */ }
    setSession(null); setView(null); setErr('');
    go(mode);
  };

  // 提交动作（轮询 + 提交共用状态）
  const submitAction = async (action: any): Promise<void> => {
    if (!session) return;
    try {
      setView(await apiSubmitAction(session.roomId, session.token, action));
    } catch (e) {
      setErr((e as Error).message);
      // 动作失败后强制刷新一次
      try { setView(await apiPoll(session.roomId, session.token)); } catch { /* ignore */ }
    }
  };

  // 进入对局阶段时触发 fit 重跑（让 .online-game 旋转适配）
  useEffect(() => {
    if (view && view.roomPhase === 'playing') {
      // 触发 fit 的 resize 监听器
      window.dispatchEvent(new Event('resize'));
      // 再下一帧兜底（OnlineGame 首次渲染后 className 才生效）
      const raf = requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
      return () => cancelAnimationFrame(raf);
    }
  }, [view?.roomPhase]);

  // ---------- 对局中 / 房间结束（含最后一局结算页）：交给联机对局组件 ----------
  // roomPhase='over' 也必须渲染 OnlineGame —— 否则第 4 局结束房间变 over 会直接掉回大厅表单，结算页没机会显示
  if (view && (view.roomPhase === 'playing' || view.roomPhase === 'over') && session) {
    return (
      <OnlineGame
        view={view}
        session={session}
        submitAction={submitAction}
        onLeave={doLeave}
        nextRound={async () => {
          if (!session) return;
          try { setView(await apiNextRound(session.roomId, session.token)); } catch (e) { setErr((e as Error).message); }
        }}
      />
    );
  }

  // ---------- 大厅 ----------
  if (session && view) {
    const me = view.players.find((p) => p.seat === view.seat);
    const isHost = view.seat === 0;
    const humans = view.players.filter((p) => !p.isBot);
    const others = humans.filter((p) => p.seat !== 0);
    const othersReady = others.length === 0 || others.every((p) => p.ready);
    return (
      <div className="stage simple stage-portrait">
        <span className="back" onClick={doLeave}>‹ 退出房间</span>
        <h2>好友房</h2>
        <div className="body">
          <div className="room-code" style={{ fontSize: 40, letterSpacing: 10, color: 'var(--gold-light)', fontFamily: 'var(--serif)', textAlign: 'center', margin: '6px 0 2px' }}>
            {view.roomId}
          </div>
          {/* 方案1+3：复制房间号 / 复制房间链接（发完点微信返回键即可回到房间，身份不丢） */}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 4, flexWrap: 'wrap' }}>
            <button className="btn" style={{ padding: '6px 16px', fontSize: 13 }}
              onClick={() => copyText(view.roomId, '房间号已复制')}>📋 复制房间号</button>
            <button className="btn" style={{ padding: '6px 16px', fontSize: 13 }}
              onClick={() => copyText(location.origin + location.pathname + '?r=' + Date.now() + '&room=' + view.roomId, '房间链接已复制')}>🔗 复制房间链接</button>
          </div>
          <p style={{ textAlign: 'center', opacity: .7, fontSize: 12, margin: '6px 0 10px', lineHeight: 1.6 }}>
            {copied
              ? copied + '，去微信聊天粘贴发给朋友（会关闭本页）'
              : '房间号已自动复制！去聊天粘贴发给朋友，发完重新打开本链接即可自动回到房间'}
          </p>
          <div className="room-players">
            {view.players.map((p, i) => (
              <div key={i} className="row" style={{ opacity: p.isBot ? .6 : 1 }}>
                <span>{SEAT_NAMES[i]}{p.isBot ? '（电脑）' : ''}</span>
                <span style={{ color: p.ready ? 'var(--gold-light)' : 'var(--rice)' }}>
                  {p.name} {p.ready ? '已准备 ✓' : p.isBot ? '待命' : '未准备'}
                </span>
              </div>
            ))}
          </div>
          <div className="row"><span>局数</span><span>{view.rounds} 局</span></div>
          <div style={{ marginTop: 14, display: 'flex', gap: 10, justifyContent: 'center' }}>
            {me && !isHost && (
              <button className="btn btn-gold" onClick={toggleReady}>{me.ready ? '取消准备' : '准备'}</button>
            )}
            {isHost && (
              <button className="btn btn-gold" style={{ opacity: othersReady ? 1 : .5 }} disabled={!othersReady || busy} onClick={doStart}>
                {othersReady ? '开始游戏' : '等朋友准备…'}
              </button>
            )}
            {humans.length >= 2 && (
              <>
                <button className={`btn btn-voice ${voiceMicOn ? '' : 'off'}`} title="麦克风" onClick={() => setMicOn(!isMicOn())}><span className="ic">🎙️</span></button>
                <button className={`btn btn-voice ${voiceSpeakerOn ? '' : 'off'}`} title="喇叭" onClick={() => setSoundPanelOpen((v) => !v)}><span className="ic">🔊</span></button>
                {soundPanelOpen && (
                  <div style={{ position: 'relative' }}>
                    <SoundPanel showVoice voiceOn={voiceSpeakerOn}
                      onToggleVoice={() => setSpeakerOn(!isSpeakerOn())}
                      onClose={() => setSoundPanelOpen(false)} />
                  </div>
                )}
              </>
            )}
          </div>
          {err && <p style={{ color: '#e95b4b', marginTop: 8, textAlign: 'center' }}>{err}</p>}
          {humans.length >= 2 && session && (
            <VoiceSession roomId={session.roomId} token={session.token} micOn={voiceMicOn} speakerOn={voiceSpeakerOn} />
          )}
        </div>
      </div>
    );
  }

  // ---------- 建房 / 加入表单 ----------
  return (
    <div className="stage simple stage-portrait">
      <span className="back" onClick={() => go('')}>‹ 返回</span>
      <h2>{mode === 'create' ? '创建好友房' : '加入好友房'}</h2>
      <div className="body">
        <div className="row"><span>昵称</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="你的名字" maxLength={6} />
        </div>

        {mode === 'create' ? (
          <>
            <div className="row" style={{ marginTop: 12 }}>
              <span>局数</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="btn"
                  style={{ padding: '8px 22px', background: rounds === 4 ? 'var(--gold)' : 'transparent', color: rounds === 4 ? '#3a2c05' : 'var(--rice)', border: '1px solid rgba(244,234,216,.4)', fontWeight: rounds === 4 ? 700 : 400 }}
                  onClick={() => setRounds(4)}
                >4 局</button>
                <button
                  type="button"
                  className="btn"
                  style={{ padding: '8px 22px', background: rounds === 8 ? 'var(--gold)' : 'transparent', color: rounds === 8 ? '#3a2c05' : 'var(--rice)', border: '1px solid rgba(244,234,216,.4)', fontWeight: rounds === 8 ? 700 : 400 }}
                  onClick={() => setRounds(8)}
                >8 局</button>
              </div>
            </div>
            <button className="btn btn-gold" style={{ width: '100%', marginTop: 16 }} disabled={busy} onClick={doCreate}>
              {busy ? '创建中…' : '创建房间'}
            </button>
          </>
        ) : (
          <>
            <div className="row" style={{ marginTop: 12 }}>
              <span>房间码</span>
              <input
                value={roomIdInput}
                onChange={(e) => setRoomIdInput(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="4 位数字"
                inputMode="numeric"
                maxLength={4}
                style={{ width: 140, letterSpacing: 6, textAlign: 'center' }}
              />
            </div>
            <button className="btn btn-gold" style={{ width: '100%', marginTop: 16 }} disabled={busy} onClick={doJoin}>
              {busy ? '加入中…' : '加入房间'}
            </button>
          </>
        )}

        {err && <p style={{ color: '#e95b4b', marginTop: 10, textAlign: 'center' }}>{err}</p>}
        <p style={{ opacity: .6, marginTop: 14, fontSize: 12, textAlign: 'center' }}>
          {mode === 'create' ? '人不够时电脑自动补齐；分享房间码给朋友。' : '朋友给你房间码即可加入；人不够时电脑自动补齐。'}
        </p>
      </div>
    </div>
  );
}