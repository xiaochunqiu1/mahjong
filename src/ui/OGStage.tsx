/**
 * 对局界面（OGStage）—— 联机 + 单机共用，V3 精确复刻参考图：
 * 深绿牌桌 + 中央方位罗盘（东南西北+倒计时） + 四角玩家（名字+分数）
 * + 3D 斜立牌墙 + 平排手牌 + 顶部栏（刷新/时间/牌山条/房号/退出）
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { kindOf } from '../engine/index.js';
import { TileFace } from './TileFace.js';
import { SoundPanel } from './SoundPanel.js';
import { speakTile, speak } from '../game/sound.js';

const WIND = ['东', '南', '西', '北'];

export interface SeatInfo {
  seat: number;             // 绝对座位 0-3
  name: string;
  isBot: boolean;
  wind: string;            // 东南西北
  score: number;
  youjin: 0 | 1 | 2;
  handCount: number;
  melds: { kind: number; tiles?: number[] }[]; // tiles 完整数组（如缺就只画 kind 一张）
  flowers: number[];
  discards: number[];
  isDealer: boolean;
  active: boolean;         // 当前轮到此座位行动
}

export interface OGActions {
  hu?: () => void;
  peng?: () => void;
  gang?: () => void;
  chi?: () => void;
  pass?: () => void;
  danyou?: () => void;
  shuangyou?: () => void;
  extraGangBtns?: { label: string; onClick: () => void }[];
  /** 吃牌多组合选择：有多个合法吃法时按钮点开面板 */
  chiPicker?: { tiles: number[]; options: [number, number][]; onPick: (useKinds: [number, number]) => void };
}

export interface OGStageProps {
  roomId: string;
  roundNo: number;
  rounds: number;
  wallCount: number;
  goldKind: number;
  top: SeatInfo;
  left: SeatInfo;
  right: SeatInfo;
  me: SeatInfo;
  myDiscards: number[];
  myHand: number[];
  myDrawnTile: number | null;
  myActive: boolean;
  myCanRespond: boolean;
  /** 我的回合截止时间戳（ms）；联机无此字段则不显示倒计时 */
  deadline?: number;
  actions: OGActions;
  showActionHint?: string;
  respondHint?: string;     // 响应阶段只显示"过"时的原因提示（如"游金锁定"）
  lastEvent?: string | null;
  /** 最近出牌人座位（好友房由服务端解析；单机可省略，组件内从 lastEvent 推断） */
  lastDiscardSeat?: number | null;
  /** 自己出牌时牌河最后一张高亮所需的"我的真实名字"（联机=session.name；单机='我'） */
  myName?: string;
  /** 好友房语音开麦：显示麦克风按钮并回调（单机不传则隐藏） */
  showMic?: boolean;
  onMic?: () => void;
  /** 好友房语音喇叭(听)按钮:onSpeaker + micOn/speakerOn 控制图标样式 */
  showSpeaker?: boolean;
  onSpeaker?: () => void;
  micOn?: boolean;
  speakerOn?: boolean;
  onLeave: () => void;
  onActDrawn?: (tile: number) => void;
  curWind?: string;
}

function flowerChar(k: number): string {
  return ['春', '夏', '秋', '冬', '梅', '兰', '竹', '菊'][k - 34] ?? '?';
}

/** 牌河：仅当 showHi=true 时最后一张高亮（避免 4 家都闪） */
function River({ discs, cls, max = 12, showHi = false }: { discs: number[]; cls: string; max?: number; showHi?: boolean }) {
  const show = discs.slice(-max);
  const overflow = discs.length - show.length;
  return (
    <div className={cls}>
      {show.map((k, i) => (
        <TileFace key={i} kind={k} small extraCls={showHi && i === show.length - 1 ? 'just' : ''} />
      ))}
      {overflow > 0 && <span className="river-overflow">+{overflow}</span>}
    </div>
  );
}

/** 玩家信息块（名字+分数+标记+副露） */
function SeatInfoBlock({ info, pos }: { info: SeatInfo; pos: 'top' | 'left' | 'right' | 'me' }) {
  return (
    <div className={'seat seat-' + pos}>
      <div className="nm">
        {info.isDealer && <span className="tag dealer" style={{ marginRight: 4 }}>庄</span>}
        {info.name || '家'}
      </div>
      <div className="sc">{(info.score ?? 0) >= 0 ? '+' : ''}{info.score ?? 0}</div>
      <div className="tags">
        {info.youjin === 1 && <span className="tag">单游</span>}
        {info.youjin === 2 && <span className="tag">双游</span>}
        {info.active && <span className="tag on">行动</span>}
      </div>
      {pos !== 'me' && info.melds && info.melds.length > 0 && (
        <div className="seat-melds">
          {info.melds.map((m, i) => (
            <div key={i} className="meld-group" style={{ display: 'flex', gap: 1 }}>
              {(m.tiles && m.tiles.length > 0 ? m.tiles : [m.kind]).map((t, j) => <TileFace key={j} kind={t} small />)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** 3D 斜立牌墙（cls 需带方向：wall-h 横排 / wall-v 竖排） */
function Wall3D({ count, cls }: { count: number; cls: string }) {
  return (
    <div className={'wall ' + cls}>
      {Array.from({ length: count }).map((_, i) => <div key={i} className="w" />)}
    </div>
  );
}

/** 顶部牌山指示条（16 格，按余牌比例点亮） */
function WallMeter({ left, total = 128 }: { left: number; total?: number }) {
  const cells = 16;
  const lit = Math.max(0, Math.min(cells, Math.round((left / total) * cells)));
  return (
    <div className="wall-meter">
      {Array.from({ length: cells }).map((_, i) => <i key={i} className={i < lit ? '' : 'dim'} />)}
    </div>
  );
}

/** 中央方位罗盘：东南西北 + 中央倒计时/方位字 */
function Compass({ curWind, deadline }: { curWind: string; deadline?: number }) {
  const [now, setNow] = useState(Date.now());
  const myCountdown = deadline !== undefined && deadline > Date.now();
  useEffect(() => {
    if (!myCountdown) return;
    const iv = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(iv);
  }, [myCountdown]);
  const remain = myCountdown ? Math.max(0, Math.ceil((deadline! - now) / 1000)) : 0;

  return (
    <div className="compass">
      <span className={'cw n' + (curWind === '北' ? ' cur' : '')}>北</span>
      <span className={'cw s' + (curWind === '南' ? ' cur' : '')}>南</span>
      <span className={'cw e' + (curWind === '东' ? ' cur' : '')}>东</span>
      <span className={'cw w' + (curWind === '西' ? ' cur' : '')}>西</span>
      {myCountdown && remain > 0
        ? <span className="cd">{remain}</span>
        : <span className="cd dim">{curWind}</span>}
    </div>
  );
}

export function OGStage(props: OGStageProps): ReactNode {
  const { top, left, right, me, myDiscards, myHand, myDrawnTile, myActive, myCanRespond,
    actions, lastEvent, onLeave, onActDrawn, showActionHint, goldKind,
    roomId, roundNo, rounds, wallCount, deadline } = props;

  // 双击出牌：第一次点选牌(高亮)，再点同一张打出；点别的牌换选
  const [selectedTile, setSelectedTile] = useState<number | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  const tapHandTile = (t: number) => {
    if (!myActive || !onActDrawn) return;
    if (selectedTile === t) {
      setSelectedTile(null);
      onActDrawn(t); // 第二次点同一张 → 出牌
    } else {
      setSelectedTile(t); // 第一次点 → 选中
    }
  };

  const [time, setTime] = useState(() => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  });
  // 吃牌选择面板：多个吃法时点「吃」按钮弹出让用户挑
  const [chiPickerOpen, setChiPickerOpen] = useState(false);
  // 只在 chiPicker 从「有」变「无」(这轮吃牌不再可用)时关闭；依赖用 tiles[0] + options.length 避免父组件每次 render 创建新对象导致面板被立即关闭
  const chiKey = actions.chiPicker
    ? `${actions.chiPicker.tiles[0]}|${actions.chiPicker.options.length}`
    : 'none';
  const prevChiKeyRef = useRef(chiKey);
  useEffect(() => {
    if (prevChiKeyRef.current !== 'none' && chiKey === 'none') setChiPickerOpen(false);
    prevChiKeyRef.current = chiKey;
  }, [chiKey]);
  useEffect(() => {
    const iv = window.setInterval(() => {
      const d = new Date();
      setTime(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
    }, 20000);
    return () => window.clearInterval(iv);
  }, []);

  // 当前行动方位：服务端权威 view.current + view.dealer → 风位（父级 curWind 传入）
  const curWind: string = props.curWind ?? '东';

  // 最近出牌人座位：优先用服务端解析（好友房 view.lastDiscardSeat），单机 fallback 从 lastEvent 解析
  const lastDiscardSeat = ((): number | null => {
    if (props.lastDiscardSeat !== undefined) return props.lastDiscardSeat;
    const ev = props.lastEvent ?? '';
    const m = ev.match(/^(\S+)\s+打出/);
    if (!m) return null;
    const name = m[1]!;
    const all = [top, left, right, me];
    if (name === '我' || (props.myName && name === props.myName)) return me.seat;
    const found = all.find((p) => p.name === name);
    return found?.seat ?? null;
  })();

  // 撒花：移到 Game/OnlineGame 父组件用 portal 到 body，避免 OGStage 卸载时丢失

  return (
    <div className="stage online-game og">
      {/* 顶部栏 */}
      <div className="topbar">
        <button className="tb-refresh" onClick={() => window.location.reload()}>刷新界面</button>
        <span className="tb-time">{time}</span>
        <span className="tb-room">房间:{roomId}</span>
        {props.showMic && (
          <button className={`tb-mic ${props.micOn === false ? 'off' : ''}`} title="麦克风" onClick={props.onMic}><span className="ic">🎙️</span></button>
        )}
        {props.showSpeaker && (
          <button className={`tb-mic ${props.speakerOn === false ? 'off' : ''}`} title="喇叭" onClick={() => setPanelOpen((v) => !v)}><span className="ic">🔊</span></button>
        )}
        {panelOpen && (
          <div style={{ position: 'relative' }}>
            <SoundPanel showVoice={!!props.onSpeaker} voiceOn={props.speakerOn !== false}
              onToggleVoice={() => props.onSpeaker?.()}
              onClose={() => setPanelOpen(false)} />
          </div>
        )}
        <button className="tb-exit" onClick={onLeave}>退出</button>
      </div>
      <WallMeter left={wallCount} />

      {/* 四角玩家 */}
      <SeatInfoBlock info={top} pos="top" />
      <SeatInfoBlock info={left} pos="left" />
      <SeatInfoBlock info={right} pos="right" />
      <SeatInfoBlock info={me} pos="me" />

      {/* 3D 斜立牌墙（只保留左右两排：左=左家、右=右家） */}
      <Wall3D count={left.handCount} cls="wall-v wall-left" />
      <Wall3D count={right.handCount} cls="wall-v wall-right" />

      {/* 金牌（罗盘上方独立小图） */}
      <div className="gold-flag"><TileFace kind={goldKind} small /></div>

      {/* 中央方位罗盘 */}
      <Compass curWind={curWind} deadline={deadline} />

      {/* 出牌河 */}
      <River discs={top.discards} cls="river river-top" showHi={lastDiscardSeat === top.seat} />
      <River discs={left.discards} cls="river river-left" showHi={lastDiscardSeat === left.seat} />
      <River discs={right.discards} cls="river river-right" showHi={lastDiscardSeat === right.seat} />
      <River discs={myDiscards} cls="river river-mine" showHi={lastDiscardSeat === me.seat} />

      {/* 中央文字 + 剩牌信息 */}
      <div className="foot-info">剩 <b>{wallCount}</b> 张　第 <b>{roundNo}</b> 局</div>

      {/* 我的副露与花（手牌左侧）——每组副露显示全部 tiles（吃碰杠 3~4 张） */}
      <div className="my-melds">
        {me.melds.map((m, i) => {
          const tiles = m.tiles && m.tiles.length > 0 ? m.tiles : [m.kind];
          return (
            <div key={i} className="meld-group" style={{ display: 'flex', gap: 1 }}>
              {tiles.map((t, j) => <TileFace key={j} kind={t} small />)}
            </div>
          );
        })}
      </div>
      <div className="my-flowers">
        {me.flowers.map((f, i) => <span key={i} className="flower-chip">{flowerChar(f)}</span>)}
      </div>

      {/* 底部平排手牌 */}
      <div className="my-hand-flat">
        {myHand.map((t) => {
          const isGold = kindOf(t) === goldKind;
          const isDrawn = t === myDrawnTile;
          const extra = (isDrawn ? 'just-drawn ' : '') + (isGold ? 'gold-hand' : '');
          return (
            <TileFace key={t} kind={kindOf(t)} extraCls={extra}
              onClickTile={myActive && onActDrawn ? () => tapHandTile(t) : undefined}
              selected={selectedTile === t} />
          );
        })}
      </div>

{/* 圆形操作按钮（按阶段精准显示——每个按钮只在对应合法动作存在时出现） */}
  <div className="actions-round">
    {myActive && (
      <>
        {actions.hu && <button className="act hu" onClick={actions.hu}>胡</button>}
        {actions.danyou && <button className="act gold small" onClick={actions.danyou}>游</button>}
        {actions.shuangyou && <button className="act gold small" onClick={actions.shuangyou}>双</button>}
        {actions.extraGangBtns?.map((b, i) => (
          <button key={'g' + i} className="act gang small" onClick={b.onClick}>{b.label}</button>
        ))}
        {!actions.hu && !actions.danyou && !actions.shuangyou && !actions.extraGangBtns?.length && showActionHint && (
          <span style={{ color: 'rgba(248,243,228,.8)', fontSize: 13, letterSpacing: 2 }}>{showActionHint}</span>
        )}
      </>
    )}
    {myCanRespond && (
      <>
        {actions.hu && <button className="act hu" onClick={actions.hu}>胡</button>}
        {actions.peng && <button className="act peng" onClick={actions.peng}>碰</button>}
        {actions.gang && <button className="act gang" onClick={actions.gang}>杠</button>}
        {actions.chi && (actions.chiPicker
          ? <button className="act chi small" onClick={() => setChiPickerOpen(true)}>吃</button>
          : <button className="act chi small" onClick={actions.chi}>吃</button>)}
        {actions.pass && <button className="act pass" onClick={actions.pass}>过</button>}
        {/* 响应阶段只显示"过"——说明游金锁定或牌面不允许其他动作 */}
        {!actions.hu && !actions.peng && !actions.gang && !actions.chi && (
          <span style={{ color: 'rgba(248,243,228,.7)', fontSize: 12, letterSpacing: 1, marginLeft: 12 }}>
            {props.respondHint ?? '可过'}
          </span>
        )}
      </>
    )}
  </div>

      {/* 响应窗口金色脉冲 */}
      {myCanRespond && <div className="response-alert" />}

      {/* 事件 toast */}
      {lastEvent && <div className="event-toast">{lastEvent}</div>}

      {/* 吃牌选择面板：列三张牌让用户挑吃法 */}
      {chiPickerOpen && actions.chiPicker && actions.chiPicker.tiles[0] !== undefined && (
        <div className="chi-picker">
          <div className="chi-picker-card">
            <div className="chi-picker-title">选择吃法</div>
            <div className="chi-picker-options">
              {actions.chiPicker.options.map((useKinds, i) => {
                const discardKind = actions.chiPicker!.tiles[0]!;
                return (
                  <button key={i} className="chi-picker-opt" onClick={() => {
                    // 同步喊出吃入的顺子（保持手势上下文内播报）
                    for (const k of useKinds) speakTile(k);
                    speakTile(discardKind);
                    actions.chiPicker!.onPick(useKinds);
                    setChiPickerOpen(false);
                  }}>
                    {useKinds.map((k, j) => <TileFace key={`u${j}`} kind={k} small />)}
                    <TileFace kind={discardKind} small />
                  </button>
                );
              })}
            </div>
            <button className="chi-picker-cancel" onClick={() => setChiPickerOpen(false)}>取消</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function windOfSeat(seat: number, dealer: number): string {
  return WIND[(seat - dealer + 4) % 4] ?? '东';
}