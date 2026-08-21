import { memo, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  createSession, startRound, humanAct, tick, nextRound, loadRecords,
  type SoloSession,
} from '../game/controller.js';
import { sortHandForDisplay } from '../game/sortHand.js';
import { kindOf, type GameAction, type RoundResult } from '../engine/index.js';
import { TileFace } from './TileFace.js';
import { playForEvent, speak, chord } from '../game/sound.js';
import { OGStage, windOfSeat } from './OGStage.js';
import { SoundPanel } from './SoundPanel.js';

const NAMES = ['我', '阿美', '阿强', '阿珠'] as const;

function flowerChar(kind: number): string {
  return ['春', '夏', '秋', '冬', '梅', '兰', '竹', '菊'][kind - 34] ?? '';
}

function prettyLog(l: string): string {
  const names = NAMES as readonly string[];
  let s = l.replace(/seat([0-3])/g, (_, n: string) => names[Number(n)] ?? '家');
  s = s
    .replace(/^开金:/, '开金：')
    .replace(/^补花:([^:]+):/, '补花：$1 ')
    .replace(/^摸牌:([^:]+):/, '$1 摸 ')
    .replace(/^出牌:([^:]+):/, '$1 打出 ')
    .replace(/^暗杠:([^:]+):/, '$1 暗杠 ')
    .replace(/^加杠:([^:]+):/, '$1 加杠 ')
    .replace(/^明杠:([^:]+):/, '$1 杠 ')
    .replace(/^碰:([^:]+):/, '$1 碰 ')
    .replace(/^吃:([^:]+):/, '$1 吃 ')
    .replace(/^杠补:([^:]+):/, '$1 补牌 ')
    .replace(/^单游宣告:([^:]+):/, '$1 单游！打 ')
    .replace(/^双游宣告:([^:]+):/, '$1 双游！打 ')
    .replace(/^胡牌:([^:]+):([^:]+):/, (_, n, wt) => `${n} ${WIN_TYPE_CN[wt as string] ?? wt} `)
    .replace(/^流局$/, '流局')
    .replace(/^无人响应:/, '无人响应 ');
  return s;
}

const WIN_TYPE_CN: Record<string, string> = {
  ron: '点炮胡', zimo: '自摸', danyou: '单游自摸', shuangyou: '双游自摸', sanyou: '三游自摸',
};

function actionText(a: GameAction): string {
  switch (a.type) {
    case 'hu': return '胡';
    case 'peng': return '碰';
    case 'gang': return '杠';
    case 'chi': return '吃';
    case 'anGang': return '暗杠';
    case 'jiaGang': return '加杠';
    case 'discard': return a.declare === 'danyou' ? '单游' : a.declare === 'shuangyou' ? '双游' : '打';
    default: return a.type;
  }
}

function winText(t: string): string {
  switch (t) {
    case 'ron': return '点炮胡';
    case 'zimo': return '自摸';
    case 'danyou': return '单游胡';
    case 'shuangyou': return '双游胡';
    case 'sanyou': return '三游胡！';
    default: return t;
  }
}
function formatDelta(v: number): string { return v >= 0 ? `+${v}` : `${v}`; }
function rankText(scores: number[]): string {
  const sorted = [...scores].sort((a, b) => b - a);
  return `${sorted.indexOf(scores[0]!) + 1} 名`;
}

export function Game({ rounds: initialRounds, onExit }: { rounds: number; onExit: () => void }) {
  const sessionRef = useRef<SoloSession | null>(null);
  const [, force] = useState(0);
  const [rounds] = useState<number>(initialRounds);

  // 监听 engine log 末尾新增 → 触发音效 + TTS + 游金撒花/喊话
  const lastLogRef = useRef<string>('');
  const [soundPanelOpen, setSoundPanelOpen] = useState(false);
  const [confetti, setConfetti] = useState<{ id: number; bursts: { id: string; x: number; y: number; delay: number; pieces: { angle: number; dist: number; color: string; size: number }[] }[] } | null>(null);
  useEffect(() => {
    const st = sessionRef.current?.state;
    if (!st) return;
    const last = st.log[st.log.length - 1] ?? '';
    if (last && last !== lastLogRef.current) {
      lastLogRef.current = last;
      playForEvent(last);
      // 游金自摸：烟花 + 延迟喊"游金我最棒！"（单机房专用文案；好友房用"X 游金你最棒！"）——等琶音音效播完，避免重叠
      const m = last.match(/^胡牌:seat[0-3]:(danyou|shuangyou|sanyou):/);
      if (m) {
        window.setTimeout(() => speak('游金我最棒！'), 600);
        // 满屏爆炸烟花：多个爆炸点 + 每朵 12 条彩色粒子向外飞散
        const COLORS = ['#ffd86b', '#ff6b6b', '#ff9f43', '#54d2ff', '#7bed9f', '#ff9ff3', '#f8f3e4'];
        const bursts = Array.from({ length: 12 }, (_, bi) => ({
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
  }, [sessionRef.current?.state?.log.length]);

  useEffect(() => {
    if (!sessionRef.current) {
      sessionRef.current = createSession((Date.now() % 1000000) + 7, rounds);
      startRound(sessionRef.current);
    }
    const iv = setInterval(() => {
      const s = sessionRef.current;
      if (s) { tick(s); force((n) => n + 1); }
    }, 150);
    return () => clearInterval(iv);
  }, [rounds]);

  const s = sessionRef.current;
  const phaseNow = s?.state?.phase.t;

  // 切换到结算页时主动触发 fit（确保旋转横屏）——必须在条件 return 之前声明（React Hooks 规则）
  useEffect(() => {
    window.dispatchEvent(new Event('resize'));
  }, [phaseNow]);

  if (!s?.state) {
    return <>
      {confetti && createPortal(
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
        </div>, document.body)}
    </>;
  }
  const state = s.state;

  const doAct = (a: GameAction) => {
    if (a.type === 'hu') {
      // 立刻喊"胡啦"（不等 controller tick 异步播报，按钮手势上下文内最稳）
      speak('胡啦');
      chord([523, 659, 784, 1047], 0.30, 0.14);
    }
    humanAct(s, a);
    force((n) => n + 1);
  };

  if (state.phase.t === 'over') {
    const result = (state.phase as { t: 'over'; result: RoundResult }).result;
    return (
      <>
        {confetti && createPortal(
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
          </div>, document.body)}
        <div className="stage online-game og">
        <button onClick={onExit}
          style={{ position: 'absolute', top: 10, right: 14, zIndex: 10, background: 'rgba(6,32,24,.6)', border: '1px solid rgba(232,201,95,.5)', color: '#ffe9a8', padding: '3px 12px', borderRadius: 999, fontSize: 12, cursor: 'pointer' }}
        >退出</button>
        <div className="overlay">
          {/* 结算页声音面板(音效/背景乐,单机无"其他玩家")——和好友房一致 */}
          <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 60 }}>
            <button className="tb-mic" onClick={() => setSoundPanelOpen((v) => !v)} title="声音"><span className="ic">🔊</span></button>
            {soundPanelOpen && (
              <SoundPanel showVoice={false} voiceOn={false} onToggleVoice={() => {}} onClose={() => setSoundPanelOpen(false)} />
            )}
          </div>
          <div className="card">
            <h2>{result.liuju ? '流 局' : `${NAMES[result.winner]}${winText(result.score.winType)}`}</h2>
            {/* 四家积分表：当局得分 + 累计积分（和好友房风格一致） */}
            <div className="settle-table">
              <div className="st-row st-head"><span>玩家</span><span>本局</span><span>累计</span></div>
              {NAMES.map((n, i) => (
                <div key={i} className="st-row">
                  <span>{i === 0 ? '我' : n}{i === s.match.dealer ? '（庄）' : ''}</span>
                  <span style={{ color: (result.score.delta[i] ?? 0) >= 0 ? 'var(--gold-light)' : '#7fc8a9' }}>
                    {(result.score.delta[i] ?? 0) >= 0 ? '+' : ''}{result.score.delta[i] ?? 0}
                  </span>
                  <span>{s.match.scores[i] ?? 0}</span>
                </div>
              ))}
            </div>
            {s.match.over && (
              <div className="score-line" style={{ marginTop: 10 }}>整场结束，我排名 <b>{rankText(s.match.scores)}</b></div>
            )}
            {/* 分端按钮：左侧主操作（下一局或整场结束无下一局），右侧返回首页（对应好友房"离开房间"） */}
            <div className="actions-row" style={{ marginTop: 16, padding: '0 8px' }}>
              {!s.match.over ? (
                <button className="btn btn-gold" style={{ padding: '0 28px', height: 40 }}
                  onClick={() => { nextRound(s); force((n) => n + 1); }}>
                  下一局（第 {s.match.roundNo} 局）
                </button>
              ) : (
                <span />
              )}
              <button className="btn btn-sea" onClick={onExit}>返回首页</button>
            </div>
          </div>
        </div>
      </div>
      </>
    );
  }

  const human = state.players[0]!;
  const p1 = state.players[1]!; // 下家（屏幕右）
  const p2 = state.players[2]!; // 对家（屏幕顶）
  const p3 = state.players[3]!; // 上家（屏幕左）
  const humanActs = s.humanActions;
  const myDrawTurn = state.phase.t === 'awaitDraw' && state.current === 0;
  const myDiscardTurn = state.phase.t === 'awaitDiscard' && state.current === 0;
  const respNow = state.phase.t === 'awaitResponse' && state.eligible[0] && !state.responses[0];
  // 响应阶段按手牌+出牌精准过滤（每个按钮只在能执行时显示）
  const discardKind: number | null = (state.phase as any).discard ?? null;
  const humanHand = human.hand;
  const humanKindCount: Record<number, number> = {};
  for (const t of humanHand) { const k = kindOf(t); humanKindCount[k] = (humanKindCount[k] ?? 0) + 1; }
  const canHuNow = humanActs.some((a) => a.type === 'hu');
  const canPengNow = discardKind !== null && (humanKindCount[discardKind] ?? 0) >= 2 && humanActs.some((a) => a.type === 'peng');
  const canMingGangNow = discardKind !== null && (humanKindCount[discardKind] ?? 0) === 3 && humanActs.some((a) => a.type === 'gang');
  // 吃：仅下家吃上家；手牌有两张与出牌（数牌）能组成顺子
  let canChiNow = false;
  if (discardKind !== null && discardKind < 27) {
    const group = Math.floor(discardKind / 9);
    const offset = discardKind - group * 9;
    const discardFrom = (state.phase as any).from ?? state.current;
    const isDownstream = ((discardFrom + 1) % 4) === 0;
    if (isDownstream && humanActs.some((a) => a.type === 'chi')) {
      for (let a = 0; a <= 8; a++) for (let b = a + 1; b <= 8; b++) {
        if (b + 1 === offset && (humanKindCount[group * 9 + a] ?? 0) >= 1 && (humanKindCount[group * 9 + b] ?? 0) >= 1) { canChiNow = true; break; }
        if (offset + 1 === b && a + 1 === offset && (humanKindCount[group * 9 + a] ?? 0) >= 1 && (humanKindCount[group * 9 + b] ?? 0) >= 1) { canChiNow = true; break; }
        if (offset + 1 === a && a + 1 === b && (humanKindCount[group * 9 + a] ?? 0) >= 1 && (humanKindCount[group * 9 + b] ?? 0) >= 1) { canChiNow = true; break; }
        if (canChiNow) break;
      }
    }
  }
  const canDanyou = humanActs.find((a) => a.type === 'discard' && a.declare === 'danyou');
  const canShuangyou = humanActs.find((a) => a.type === 'discard' && a.declare === 'shuangyou');
  const gangActs = humanActs.filter((a) => a.type === 'anGang' || a.type === 'jiaGang');
  const respAlert = state.phase.t === 'awaitResponse' && state.eligible[0];
  // 吃牌多组合：响应阶段若 legal 中有 ≥2 个 chi 动作，让用户挑
  const chiActs = humanActs.filter((a) => a.type === 'chi') as Array<{ type: 'chi'; useKinds: [number, number] }>;
  const chiPicker = chiActs.length > 1 && discardKind !== null
    ? { tiles: [discardKind], options: chiActs.map((a) => a.useKinds), onPick: (useKinds: [number, number]) => doAct({ type: 'chi', useKinds }) }
    : undefined;

  const lastEvent = (() => {
    for (let i = s.logs.length - 1; i >= 0; i--) {
      const l = s.logs[i]!;
      if (/出牌|碰|吃|杠|胡牌|宣告|补花/.test(l)) return prettyLog(l);
    }
    return null;
  })();

  return (
    <OGStage
      roomId="单机"
      roundNo={s.match.roundNo}
      rounds={s.match.config.rounds}
      wallCount={state.wall.length}
      goldKind={state.goldKind}
      top={{
        name: NAMES[2], seat: 2, isBot: true,
        wind: windOfSeat(2, state.dealer), score: s.match.scores[2]!,
        youjin: p2.youjin, handCount: p2.hand.length,
        melds: p2.melds.map((m) => ({ kind: m.kind, tiles: m.tiles })),
        flowers: p2.flowers, discards: p2.discards,
        isDealer: state.dealer === 2, active: state.current === 2,
      }}
      left={{
        name: NAMES[3], seat: 3, isBot: true,
        wind: windOfSeat(3, state.dealer), score: s.match.scores[3]!,
        youjin: p3.youjin, handCount: p3.hand.length,
        melds: p3.melds.map((m) => ({ kind: m.kind, tiles: m.tiles })),
        flowers: p3.flowers, discards: p3.discards,
        isDealer: state.dealer === 3, active: state.current === 3,
      }}
      right={{
        name: NAMES[1], seat: 1, isBot: true,
        wind: windOfSeat(1, state.dealer), score: s.match.scores[1]!,
        youjin: p1.youjin, handCount: p1.hand.length,
        melds: p1.melds.map((m) => ({ kind: m.kind, tiles: m.tiles })),
        flowers: p1.flowers, discards: p1.discards,
        isDealer: state.dealer === 1, active: state.current === 1,
      }}
      me={{
        seat: 0, name: '我', isBot: false,
        wind: windOfSeat(0, state.dealer), score: s.match.scores[0]!,
        youjin: human.youjin, handCount: human.hand.length,
        melds: human.melds.map((m) => ({ kind: m.kind, tiles: m.tiles })),
        flowers: human.flowers, discards: human.discards,
        isDealer: state.dealer === 0, active: state.current === 0,
      }}
      myDiscards={human.discards}
      myHand={sortHandForDisplay(human.hand, state.goldKind)}
      myDrawnTile={s.lastDrawn}
      myActive={myDiscardTurn || myDrawTurn}
      myCanRespond={respNow ?? false}
      deadline={s.phaseDeadline}
      actions={{
        hu: canHuNow ? () => { const a = humanActs.find((x) => x.type === 'hu'); if (a) doAct(a); }
          : (myDiscardTurn && canHuNow && !canDanyou && !canShuangyou ? () => doAct({ type: 'hu' }) : undefined),
        peng: canPengNow ? () => { const a = humanActs.find((x) => x.type === 'peng'); if (a) doAct(a); } : undefined,
        gang: canMingGangNow ? () => { const a = humanActs.find((x) => x.type === 'gang'); if (a) doAct(a); } : undefined,
        chi: canChiNow ? () => { const a = humanActs.find((x) => x.type === 'chi'); if (a) doAct(a); } : undefined,
        chiPicker,
        pass: respNow ? () => doAct({ type: 'pass' }) : undefined,
        danyou: canDanyou ? () => doAct(canDanyou) : undefined,
        shuangyou: canShuangyou ? () => doAct(canShuangyou) : undefined,
        extraGangBtns: gangActs.map((a) => ({
          label: actionText(a) === '暗杠' ? '暗' : actionText(a) === '加杠' ? '加' : '杠',
          onClick: () => doAct(a),
        })),
      }}
      showActionHint={undefined}
      respondHint={((): string | undefined => {
        if (!respNow) return undefined;
        if (human.youjin > 0) return '游金锁定，仅可过';
        // 金牌不能碰/杠/吃（D6 规则）
        if (discardKind !== null && discardKind === state.goldKind) return '金牌不能碰/杠/吃';
        if (discardKind !== null && discardKind < 27) {
          if (!canChiNow) {
            const discardFrom2 = (state.phase as any).from ?? state.current;
            const isDownstream = ((discardFrom2 + 1) % 4) === 0;
            if (!isDownstream) return '非下家不能吃';
            // 下家但缺牌——告诉用户具体差哪张
            const group = Math.floor(discardKind / 9);
            const offset = discardKind - group * 9;
            const suitName = ['万','条','筒'][group] ?? '牌';
            const missing: number[] = [];
            // 检查三种顺子 [a,b,offset] / [a,offset,b] / [offset,a,b]
            const check = (a: number, b: number) => {
              if (a >= 0 && a <= 8 && (humanKindCount[group * 9 + a] ?? 0) < 1) missing.push(a + 1);
              if (b >= 0 && b <= 8 && (humanKindCount[group * 9 + b] ?? 0) < 1) missing.push(b + 1);
            };
            if (offset - 2 >= 0) check(offset - 2, offset - 1);     // [a,b,offset]
            if (offset - 1 >= 0 && offset + 1 <= 8) check(offset - 1, offset + 1); // [a,offset,b]
            if (offset + 2 <= 8) check(offset + 1, offset + 2);     // [offset,a,b]
            if (missing.length > 0) return `缺 ${[...new Set(missing)].map((n) => n + suitName).join('、')}`;
            return '手牌无顺子可吃';
          }
        }
        if (discardKind !== null && discardKind >= 27) return '字牌不能吃';
        if (discardKind !== null && !canHuNow) return '手牌无胡牌型';
        return undefined;
      })()}
      lastEvent={lastEvent}
      onLeave={onExit}
      onActDrawn={(t) => doAct({ type: 'discard', tile: t })}
      curWind={state.current === 0 ? '西' : state.current === 1 ? '南' : state.current === 2 ? '东' : '北'}
    />
  );
}