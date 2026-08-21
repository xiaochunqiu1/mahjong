/**
 * 联机对局视图：数据来自服务端裁剪视图（OnlineRoomView），
 * 视觉由共享的 OGStage 组件渲染（深绿牌桌 + 圆形金牌 + 弧形手牌 + 3D牌墙）。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { kindOf } from '../engine/index.js';
import { sortHandForDisplay } from '../game/sortHand.js';
import { createPortal } from 'react-dom';
import { triggerFromEvent, speakTile, speak, chord } from '../game/sound.js';
import { isMicOn, isSpeakerOn, setMicOn, setSpeakerOn, onVoiceChange } from '../game/voice.js';
import { SoundPanel } from './SoundPanel.js';
import type { OnlineRoomView } from '../game/online.js';
import { OGStage, windOfSeat, type SeatInfo } from './OGStage.js';
import { VoiceSession } from './VoiceSession.js';

const WIND = ['东', '南', '西', '北'];

function actionText(a: any): string {
  switch (a.type) {
    case 'hu': return '胡';
    case 'peng': return '碰';
    case 'gang': return '杠';
    case 'chi': return '吃';
    case 'anGang': return '暗杠';
    case 'jiaGang': return '加杠';
    default: return a.type;
  }
}

export function OnlineGame({ view, session, submitAction, onLeave, nextRound, onUntrust }: {
  view: OnlineRoomView;
  session: { roomId: string; token: string; name: string };
  submitAction: (action: any) => Promise<void>;
  onLeave: () => void;
  nextRound?: () => Promise<void>;
  onUntrust: () => void;
}) {
  const seat = view.seat;
  const goldKind = view.goldKind;
  const me = view.self;
  const others = view.others;
  // 屏幕位置 → 绝对座位
  const seatAt = (pos: 'top' | 'bottom' | 'left' | 'right'): number =>
    pos === 'bottom' ? seat : pos === 'right' ? (seat + 1) % 4 : pos === 'top' ? (seat + 2) % 4 : (seat + 3) % 4;
  const topP = others.find((o) => o.seat === seatAt('top'));
  const leftP = others.find((o) => o.seat === seatAt('left'));
  const rightP = others.find((o) => o.seat === seatAt('right'));

  const legal = view.legal ?? [];
  const myTurn = view.yourTurn;
  const myRespond = view.canRespond;
  const phase = view.phase?.t ?? '';
  const isOver = view.roomPhase === 'over' || phase === 'over';
  const over = view.overResult;

  // 监听 lastEvent 变化 → 触发音效 + 游金撒花/喊话
  const lastEventRef = useRef<string>('');
  const [confetti, setConfetti] = useState<{ id: number; bursts: { id: string; x: number; y: number; delay: number; pieces: { angle: number; dist: number; color: string; size: number }[] }[] } | null>(null);
  const [settlePanelOpen, setSettlePanelOpen] = useState(false);
  const [localUntrusted, setLocalUntrusted] = useState(false);
  const [voiceMicOn, setVoiceMicOnState] = useState(isMicOn);    // 来自全局 store（大厅/对局共享）
  const [voiceSpeakerOn, setVoiceSpeakerOnState] = useState(isSpeakerOn);
  useEffect(() => onVoiceChange(() => { setVoiceMicOnState(isMicOn()); setVoiceSpeakerOnState(isSpeakerOn()); }), []);
  useEffect(() => {
    if (view.lastEvent && view.lastEvent !== lastEventRef.current) {
      lastEventRef.current = view.lastEvent;
      triggerFromEvent(view.lastEvent);
      // 游金自摸：烟花 + 延迟喊"{name} 游金你最棒！"（等琶音播完再喊）
      if (view.lastEvent.includes('游') && view.lastEvent.includes('自摸')) {
        const m = view.lastEvent.match(/^(\S+?)\s+(单游自摸|双游自摸|三游自摸)/);
        if (m && m[1]) {
          const msg = `${m[1]} 游金你最棒！`;
          window.setTimeout(() => speak(msg), 600);
        }
        const COLORS = ['#ffd86b', '#ff6b6b', '#ff9f43', '#54d2ff', '#7bed9f', '#ff9ff3', '#f8f3e4'];
        const bursts = Array.from({ length: 10 }, (_, bi) => ({
          id: `${Date.now()}-${bi}`,
          x: 8 + Math.random() * 84, y: 15 + Math.random() * 70,
          delay: Math.random() * 1.4,
          pieces: Array.from({ length: 14 }, (_, pi) => ({
            angle: (Math.PI * 2 * pi) / 14,
            dist: 40 + Math.random() * 55,
            color: COLORS[Math.floor(Math.random() * COLORS.length)]!,
            size: 4 + Math.random() * 5,
          })),
        }));
        const id = Date.now();
        setConfetti({ id, bursts });
        window.setTimeout(() => setConfetti((c) => (c && c.id === id ? null : c)), 6500);
      }
    }
  }, [view.lastEvent]);

  // 烟花 portal：渲染到 body 避免 OGStage 卸载时丢失
  const confettiPortal = confetti && createPortal(
    <div className="fireworks" key={confetti.id}>
      {confetti.bursts.map((b) => (
        <div key={b.id} className="firework" style={{ left: `${b.x}%`, top: `${b.y}%`, animationDelay: `${b.delay}s` }}>
          {b.pieces.map((p, i) => (
            <span key={i} className="firework-piece"
              style={{
                '--ang': `${p.angle}rad`, '--dist': `${p.dist}px`,
                '--col': p.color, width: `${p.size}px`, height: `${p.size}px`,
              } as React.CSSProperties} />
          ))}
        </div>
      ))}
    </div>, document.body);

  // 我的回合且需要摸牌 → 自动摸
  const drewRef = useRef(false);
  useEffect(() => {
    if (myTurn && phase === 'awaitDraw' && legal.some((a: any) => a.type === 'draw')) {
      if (!drewRef.current) {
        drewRef.current = true;
        submitAction({ type: 'draw' }).then(() => { drewRef.current = false; });
      }
    } else {
      drewRef.current = false;
    }
  }, [myTurn, phase, legal, submitAction]);

  // 新摸的牌高亮：hand 长度变化检测
  const [drawnTile, setDrawnTile] = useState<number | null>(null);
  const prevHandRef = useRef<number[]>([]);
  useEffect(() => {
    // 手牌相对上一帧**新增**的牌 = 刚摸/杠补/花补的牌（id 全局唯一，差集可靠；不只看 +1 长度，杠补后手牌总数可能 -3 但仍有新增牌）
    const cur = me?.hand ?? [];
    const prev = prevHandRef.current ?? [];
    const newTiles = cur.filter((t) => !prev.includes(t));
    if (newTiles.length > 0) {
      setDrawnTile(newTiles[newTiles.length - 1]!);
    } else if (cur.length < prev.length) {
      setDrawnTile(null);
    }
    prevHandRef.current = cur;
  }, [me?.hand]);

  const hand = useMemo(() => (me ? sortHandForDisplay(me.hand, goldKind) : []), [me, goldKind]);
  // 响应阶段按手牌+出牌精准过滤每个动作的可行性
  const discardKind = (view.phase?.discard as number | undefined) ?? null;
  const meHand = me?.hand ?? [];
  const meKindCount: Record<number, number> = {};
  for (const t of meHand) { const k = kindOf(t); meKindCount[k] = (meKindCount[k] ?? 0) + 1; }
  // 服务端 legal 已校验类型合法性——客户端根据手牌 + 出牌判断"我能不能做这个动作"
  const respondActs = legal.filter((a: any) => ['hu', 'peng', 'gang', 'chi', 'pass'].includes(a.type));
  const canHuNow = respondActs.some((a: any) => a.type === 'hu');
  const canPengNow = discardKind !== null && (meKindCount[discardKind] ?? 0) >= 2
    && respondActs.some((a: any) => a.type === 'peng');
  const canMingGangNow = discardKind !== null && (meKindCount[discardKind] ?? 0) === 3
    && respondActs.some((a: any) => a.type === 'gang');
  // 吃（仅下家吃上家 = 出牌人）：用 phase.from 比 view.current 更可靠
  let canChiNow = false;
  if (discardKind !== null && discardKind < 27) {
    const group = Math.floor(discardKind / 9);
    const offset = discardKind - group * 9;
    const discardFrom = (view.phase?.from as number | undefined) ?? view.current ?? -1;
    const isDownstream = (discardFrom + 1) % 4 === seat;
    if (isDownstream && respondActs.some((a: any) => a.type === 'chi')) {
      // 检查手牌中是否有两张能与出牌组成 [a, b, offset] 顺子（a<b 且 a+1=b 且 b+1=offset）或类似
      for (let a = 0; a <= 8; a++) {
        for (let b = a + 1; b <= 8; b++) {
          // (a, b, offset) 顺子
          if (b + 1 === offset && (meKindCount[group * 9 + a] ?? 0) >= 1 && (meKindCount[group * 9 + b] ?? 0) >= 1) { canChiNow = true; break; }
          // (a, offset, b) 顺子
          if (offset + 1 === b && a + 1 === offset && (meKindCount[group * 9 + a] ?? 0) >= 1 && (meKindCount[group * 9 + b] ?? 0) >= 1) { canChiNow = true; break; }
          // (offset, a, b) 顺子
          if (offset + 1 === a && a + 1 === b && (meKindCount[group * 9 + a] ?? 0) >= 1 && (meKindCount[group * 9 + b] ?? 0) >= 1) { canChiNow = true; break; }
        }
        if (canChiNow) break;
      }
    }
  }
  const canDanyou = legal.find((a: any) => a.type === 'discard' && a.declare === 'danyou');
  const canShuangyou = legal.find((a: any) => a.type === 'discard' && a.declare === 'shuangyou');
  const gangActs = legal.filter((a: any) => a.type === 'anGang' || a.type === 'jiaGang');
  const canHu = legal.some((a: any) => a.type === 'hu');
  // 吃牌多组合：响应阶段若 legal 中有 ≥2 个 chi 动作，让用户挑
  const chiActs = respondActs.filter((a: any) => a.type === 'chi') as Array<{ type: 'chi'; useKinds: [number, number] }>;
  const chiPicker = chiActs.length > 1 && discardKind !== null
    ? { tiles: [discardKind], options: chiActs.map((a) => a.useKinds), onPick: (useKinds: [number, number]) => submitAction({ type: 'chi', useKinds }) }
    : undefined;

  // 超时自动动作：倒计时结束后自动出牌/过（每 1s 检查，避免 setTimeout 被轮询重置）
  const actedAutoRef = useRef(false);
  useEffect(() => {
    actedAutoRef.current = false;
    const iv = window.setInterval(() => {
      const dl = view.deadline ?? 0;
      if (!dl || Date.now() < dl || actedAutoRef.current) return;
      actedAutoRef.current = true;
      if (myRespond) {
        const pass = legal.find((a: any) => a.type === 'pass');
        if (pass) submitAction(pass);
      } else if (myTurn && phase === 'awaitDiscard') {
        const plain = legal.find((a: any) => a.type === 'discard' && !a.declare);
        if (plain) submitAction(plain);
      }
    }, 1000);
    return () => window.clearInterval(iv);
  }, [view, myTurn, myRespond, phase, legal, submitAction]);

  const isHu = myTurn && phase === 'awaitDiscard' && canHu;
  const isMyDiscard = myTurn && phase === 'awaitDiscard';
  const seatIdx = (p: typeof topP) => p?.seat ?? -1;
  const myWind = windOfSeat(seat, view.dealer);
  const myScore = view.scores[seat] ?? 0;

  // 切换到结算页时主动触发 fit（确保旋转横屏）
  useEffect(() => {
    window.dispatchEvent(new Event('resize'));
  }, [phase]);

  // 本局结束弹层
  if (isOver && over) {
    const meIsBot = view.players.find((p) => p.seat === seat)?.isBot ?? false;
    const myNextReady = (view.nextReady ?? []).includes(seat);
    const humans = view.players.filter((p) => !p.isBot);
    const readyCount = humans.filter((p) => (view.nextReady ?? []).includes(p.seat)).length;
    return (
      <div className="stage online-game og">
        {confettiPortal}
        <div className="overlay">
          {/* 结算页声音面板(音效/背景乐/其他玩家)——与大厅/对局一致 */}
          <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 60 }}>
            <button className="tb-mic" onClick={() => setSettlePanelOpen((v) => !v)} title="声音"><span className="ic">🔊</span></button>
            {settlePanelOpen && (
              <SoundPanel showVoice voiceOn={voiceSpeakerOn}
                onToggleVoice={() => setSpeakerOn(!isSpeakerOn())}
                onClose={() => setSettlePanelOpen(false)} />
            )}
          </div>
          <div className="card">
            <h2>{over.liuju ? '流局' : over.winner === seat ? '我赢了！' : over.winType === 'ron' ? '点炮' : '其他玩家胡了'}</h2>
            <div className="score-line">{over.liuju ? '无人胡牌' : `${view.players.find((p) => p.seat === over.winner)?.name ?? '?'} ${over.winType}`}</div>
            {/* 四家积分表：当局得分 + 累计积分 */}
            <div className="settle-table">
              <div className="st-row st-head"><span>玩家</span><span>本局</span><span>累计</span></div>
              {view.players.map((p) => (
                <div key={p.seat} className="st-row">
                  <span>{p.seat === seat ? '我' : p.name}{p.seat === view.dealer ? '（庄）' : ''}</span>
                  <span style={{ color: (over.delta[p.seat] ?? 0) >= 0 ? 'var(--gold-light)' : '#7fc8a9' }}>
                    {(over.delta[p.seat] ?? 0) >= 0 ? '+' : ''}{over.delta[p.seat] ?? 0}
                  </span>
                  <span>{view.scores[p.seat] ?? 0}</span>
                </div>
              ))}
            </div>
            <div className="actions-row" style={{ justifyContent: 'space-between', marginTop: 16, padding: '0 16px' }}>
              {/* 所有真人都有"下一局"：全员同意才开；退出者不计 */}
              {view.roomPhase === 'playing' && view.waitingNext && !meIsBot && nextRound && (
                myNextReady
                  ? <button className="btn btn-gold" style={{ opacity: .6, cursor: 'default' }} disabled>已同意（{readyCount}/{humans.length}）…</button>
                  : <button className="btn btn-gold" onClick={() => nextRound()}>下一局</button>
              )}
              <button className="btn btn-sea" onClick={onLeave}>离开房间</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
    <OGStage
      roomId={view.roomId}
      roundNo={view.roundNo}
      rounds={view.rounds}
      wallCount={view.wallCount}
      goldKind={goldKind}
      top={{
        seat: seatIdx(topP),
        name: topP?.name ?? '',
        isBot: topP?.isBot ?? true,
        wind: windOfSeat(seatIdx(topP), view.dealer),
        score: view.scores[seatIdx(topP)] ?? 0,
        youjin: topP?.youjin ?? 0,
        handCount: topP?.handCount ?? 0,
        melds: topP?.melds ?? [],
        flowers: topP?.flowers ?? [],
        discards: topP?.discards ?? [],
        isDealer: seatIdx(topP) === view.dealer,
        active: view.current === seatIdx(topP),
        trusted: topP ? view.trusted?.[topP.seat] : false,
      }}
      left={{
        seat: seatIdx(leftP),
        name: leftP?.name ?? '',
        isBot: leftP?.isBot ?? true,
        wind: windOfSeat(seatIdx(leftP), view.dealer),
        score: view.scores[seatIdx(leftP)] ?? 0,
        youjin: leftP?.youjin ?? 0,
        handCount: leftP?.handCount ?? 0,
        melds: leftP?.melds ?? [],
        flowers: leftP?.flowers ?? [],
        discards: leftP?.discards ?? [],
        isDealer: seatIdx(leftP) === view.dealer,
        active: view.current === seatIdx(leftP),
        trusted: leftP ? view.trusted?.[leftP.seat] : false,
      }}
      right={{
        seat: seatIdx(rightP),
        name: rightP?.name ?? '',
        isBot: rightP?.isBot ?? true,
        wind: windOfSeat(seatIdx(rightP), view.dealer),
        score: view.scores[seatIdx(rightP)] ?? 0,
        youjin: rightP?.youjin ?? 0,
        handCount: rightP?.handCount ?? 0,
        melds: rightP?.melds ?? [],
        flowers: rightP?.flowers ?? [],
        discards: rightP?.discards ?? [],
        isDealer: seatIdx(rightP) === view.dealer,
        active: view.current === seatIdx(rightP),
        trusted: rightP ? view.trusted?.[rightP.seat] : false,
      }}
      me={{
        seat: seat,
        name: '我',
        isBot: false,
        trusted: view.trusted?.[seat] ?? false,
        wind: myWind,
        score: myScore,
        youjin: me?.youjin ?? 0,
        handCount: hand.length,
        melds: me?.melds ?? [],
        flowers: me?.flowers ?? [],
        discards: me?.discards ?? [],
        isDealer: seat === view.dealer,
        active: view.current === seat,
      }}
      myDiscards={me?.discards ?? []}
      myHand={hand}
      myDrawnTile={drawnTile}
      myActive={myTurn}
      myCanRespond={myRespond}
      deadline={view.deadline ?? undefined}
      actions={{
        // 响应阶段：按手牌+出牌精准过滤（每个按钮只在能执行时显示）
        hu: canHuNow ? () => {
          // 立刻喊"胡啦"（按钮手势上下文内，不等异步播报）
          speak('胡啦');
          chord([523, 659, 784, 1047], 0.30, 0.14);
          const a = respondActs.find((x: any) => x.type === 'hu');
          if (a) submitAction(a);
        } : (isHu ? () => {
          speak('胡啦');
          chord([523, 659, 784, 1047], 0.30, 0.14);
          submitAction({ type: 'hu' });
        } : undefined),
        peng: canPengNow ? () => {
          const a = respondActs.find((x: any) => x.type === 'peng');
          if (a) submitAction(a);
        } : undefined,
        gang: canMingGangNow ? () => {
          const a = respondActs.find((x: any) => x.type === 'gang');
          if (a) submitAction(a);
        } : undefined,
        chi: canChiNow ? () => {
          const a = respondActs.find((x: any) => x.type === 'chi');
          if (a) submitAction(a);
        } : undefined,
        chiPicker,
        pass: respondActs.length > 0 ? () => submitAction({ type: 'pass' }) : undefined,
        danyou: canDanyou ? () => submitAction(canDanyou) : undefined,
        shuangyou: canShuangyou ? () => submitAction(canShuangyou) : undefined,
        extraGangBtns: gangActs.map((a) => ({
          label: actionText(a) === '暗杠' ? '暗' : actionText(a) === '加杠' ? '加' : '杠',
          onClick: () => submitAction(a),
        })),
      }}
      curWind={view.current === seat ? '西' : view.current === (seat + 1) % 4 ? '南' : view.current === (seat + 2) % 4 ? '东' : '北'}
      showActionHint={undefined}
      respondHint={((): string | undefined => {
        if (!myRespond) return undefined;
        if (me?.youjin && me.youjin > 0) return '游金锁定，仅可过';
        if (discardKind !== null && discardKind === goldKind) return '金牌不能碰/杠/吃';
        if (discardKind !== null && discardKind < 27) {
          if (!canChiNow) {
            const discardFrom2 = (view.phase?.from as number | undefined) ?? view.current ?? -1;
            const isDownstream = (discardFrom2 + 1) % 4 === seat;
            if (!isDownstream) return '非下家不能吃';
            const group = Math.floor(discardKind / 9);
            const offset = discardKind - group * 9;
            const suitName = ['万','条','筒'][group] ?? '牌';
            const missing: number[] = [];
            const check = (a: number, b: number) => {
              if (a >= 0 && a <= 8 && (meKindCount[group * 9 + a] ?? 0) < 1) missing.push(a + 1);
              if (b >= 0 && b <= 8 && (meKindCount[group * 9 + b] ?? 0) < 1) missing.push(b + 1);
            };
            if (offset - 2 >= 0) check(offset - 2, offset - 1);
            if (offset - 1 >= 0 && offset + 1 <= 8) check(offset - 1, offset + 1);
            if (offset + 2 <= 8) check(offset + 1, offset + 2);
            if (missing.length > 0) return `缺 ${[...new Set(missing)].map((n) => n + suitName).join('、')}`;
            return '手牌无顺子可吃';
          }
        }
        if (discardKind !== null && discardKind >= 27) return '字牌不能吃';
        if (discardKind !== null && !canHuNow) return '手牌无胡牌型';
        return undefined;
      })()}
      lastEvent={view.lastEvent}
      myName={session.name}
      lastDiscardSeat={view.lastDiscardSeat}
      showMic
      onMic={() => setMicOn(!isMicOn())}
      micOn={voiceMicOn}
      showSpeaker
      onSpeaker={() => setSpeakerOn(!isSpeakerOn())}
      speakerOn={voiceSpeakerOn}
      onLeave={onLeave}
      onActDrawn={(t) => {
        speakTile(kindOf(t));
        submitAction({ type: 'discard', tile: t });
      }}
    />
    {/* 我托管中:放回 OGStage 内部(position: absolute),跟着麻将一起旋转 90° → 手机横屏后用户视觉是横排,与麻将同向 */}
    {(view.trusted?.[seat] ?? false) && !localUntrusted && (
      <div style={{
        position: 'absolute', top: '50%', left: 12, transform: 'translateY(-50%)', zIndex: 70,
        display: 'flex', alignItems: 'center', gap: 8,
        background: 'rgba(6,32,24,.9)', border: '1px solid rgba(255,179,107,.6)',
        borderRadius: 999, padding: '6px 14px', fontSize: 13,
        whiteSpace: 'nowrap', boxShadow: '0 2px 10px rgba(0,0,0,.4)',
      }}>
        <span style={{ color: '#ffb36b' }}>⏳ 你已托管</span>
        <button className="btn btn-gold" style={{ padding: '4px 14px', fontSize: 12 }} onClick={() => { setLocalUntrusted(true); onUntrust(); }}>取消托管</button>
      </div>
    )}
    <VoiceSession roomId={session.roomId} token={session.token} micOn={voiceMicOn} speakerOn={voiceSpeakerOn} />
    </>
  );
}