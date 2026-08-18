import { useEffect, useRef, useState } from 'react';
import './styles/app.css';
import { Home } from './ui/Home.js';
import { Game } from './ui/Game.js';
import { Rules } from './ui/Rules.js';
import { Settings } from './ui/Settings.js';
import { History } from './ui/History.js';
import { setBgmEnabled, setSoundEnabled, unlockTTS, preloadTtsBuffers } from './game/sound.js';
import { Room } from './ui/Room.js';

function unlockAudio() {
  // 用户首次交互时解锁 AudioContext + TTS（mobile/微信限制：非手势路径被 suspended/忽略）
  // 尊重设置页的音效开关（此前无条件开启 → 用户在设置里关了音效，进游戏点屏幕又被强制打开）
  const s = localStorage.getItem('qz-mj-sound');
  setSoundEnabled(s === null ? true : s !== '0');
  unlockTTS();
  // 解锁 HTMLAudio autoplay：用云函数 TTS 真实 URL（首字符预热，第二次零延迟）
  try {
    const env = (import.meta as any).env ?? {};
    const base: string = env.VITE_TCB_URL ?? '';
    if (base) {
      const a = new Audio(base.replace(/\/room-api$/, '/tts-api') + '?text=' + encodeURIComponent('碰'));
      a.muted = true;
      a.preload = 'auto';
      a.setAttribute('playsinline', '');
      a.play().then(() => { a.pause(); }).catch(() => {});
    }
  } catch { /* ignore */ }
  // 预热常用牌名 TTS AudioBuffer（后续 createBufferSource.start 即可，无需 fetch）
  void preloadTtsBuffers([
    // 单字 + 动作词
    '一', '二', '三', '四', '五', '六', '七', '八', '九', '万', '条', '筒',
    '东', '南', '西', '北', '中', '发', '白', '白板', '春', '夏', '秋', '冬',
    '碰', '吃', '杠', '胡', '庄', '单游', '双游',
    // 牌名组合（数字+字）
    ...['', '一', '二', '三', '四', '五', '六', '七', '八', '九'].map(d => d + '万'),
    ...['', '一', '二', '三', '四', '五', '六', '七', '八', '九'].map(d => d + '条'),
    ...['', '一', '二', '三', '四', '五', '六', '七', '八', '九'].map(d => d + '筒'),
  ]);
}

export default function App() {
  const [route, setRoute] = useState<string>(() => {
    const q = new URLSearchParams(window.location.search).get('r');
    return q || window.location.hash.slice(1) || '';
  });
  const [rounds, setRounds] = useState<4 | 8>(4);
  // 背景乐：永远默认开启（不记忆关闭状态——用户明确要求打开链接就响；想关点首页"♪ 音乐关"，本次会话有效）
  const [bgmOn, setBgmOn] = useState<boolean>(true);

  // BGM 在**首次用户手势内**才真正启动（iOS/微信：页面加载期 play 会被拦截并弹"音视频播放被浏览器拦截"提示）
  const bgmOnRef = useRef(bgmOn);
  bgmOnRef.current = bgmOn;
  const bgmStartedRef = useRef(false);
  useEffect(() => {
    const start = () => {
      if (bgmStartedRef.current) return;
      bgmStartedRef.current = true;
      setBgmEnabled(bgmOnRef.current);
    };
    const EVT = ['touchstart', 'pointerdown', 'click', 'keydown'] as const;
    EVT.forEach((n) => window.addEventListener(n, start, { once: true }));
    return () => EVT.forEach((n) => window.removeEventListener(n, start));
  }, []);
  // 手势之后用户手动切换背景乐 → 立即生效
  useEffect(() => {
    if (!bgmStartedRef.current) return;
    setBgmEnabled(bgmOn);
  }, [bgmOn]);

  const toggleBgm = () => {
    setBgmOn((prev) => !prev);
  };

  useEffect(() => {
    const onHash = () => setRoute(window.location.hash.slice(1) || '');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

// 等比缩放横屏舞台：
  //   - 对局（game）：手机竖屏时旋转 90°，让旋转后的视觉尺寸刚好填满屏幕（不溢出裁切）
  //   - 其他路由：手机竖屏用 CSS 自适应（.stage-portrait 直接 100vw/100vh）
  //   - 桌面端：等比缩放居中（min 不变形）
  useEffect(() => {
    const fit = () => {
      const stages = document.querySelectorAll<HTMLElement>('.stage');
      // 用 clientWidth/clientHeight 更准（微信内置浏览器 viewport 可能与 innerWidth 不同）
      const vw = document.documentElement.clientWidth || window.innerWidth;
      const vh = document.documentElement.clientHeight || window.innerHeight;
      const isTouch = typeof navigator !== 'undefined' && (navigator.maxTouchPoints > 0 || 'ontouchstart' in window);
      const isMobile = isTouch && vw < 700;
      // 对局状态：game 路由 OR stage 内部含 .online-game（Room 嵌入的联机对局）
      const isPlayingStage = (s: HTMLElement) =>
        s.classList.contains('online-game') || (route === 'game' && !s.classList.contains('stage-portrait'));
      stages.forEach((s) => {
        if (s.classList.contains('stage-portrait')) {
          s.style.transform = '';
          return;
        }
        if (isMobile && vh > vw && isPlayingStage(s)) {
          // 旋转后视觉宽=375k 高=812k。min 保证两方向都不溢出（max 会让高溢出裁切！）×0.96 留安全边距
          const k = Math.min(vw / 375, vh / 812) * 0.96;
          s.style.transform = `rotate(90deg) scale(${k})`;
        } else {
          const k = Math.min(vw / 812, vh / 375);
          s.style.transform = `scale(${k})`;
        }
      });
    };
    fit();
    const raf = requestAnimationFrame(fit); // 下一帧再跑一次（路由切换后 DOM 可能延迟）
    // DOM 结构变化（如 pregame → OGStage 重渲染）时自动重新 fit——用 ResizeObserver 监听 stage 尺寸/轮询兜底
    const t1 = window.setTimeout(fit, 300);
    const t2 = window.setTimeout(fit, 1000);
    const t3 = window.setTimeout(fit, 2500);
    window.addEventListener('resize', fit);
    window.addEventListener('orientationchange', fit);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.clearTimeout(t3);
      window.removeEventListener('resize', fit);
      window.removeEventListener('orientationchange', fit);
    };
  }, [route]);

  const go = (p: string) => { unlockAudio(); window.location.hash = p; };
  if (route === '' || route === 'home') return <Home go={go} bgmOn={bgmOn} onToggleBgm={toggleBgm} />;
  if (route === 'game') return <Game rounds={rounds} onExit={() => go('')} />;
  if (route === 'create') return <Room go={go} mode="create" />;
  if (route === 'join') return <Room go={go} mode="join" />;
  if (route === 'rules') return <Rules go={go} />;
  if (route === 'settings') return <Settings go={go} />;
  if (route === 'history') return <History go={go} />;
  if (route === 'pregame') {
    return (
      <div className="stage pregame stage-portrait">
        <h2>单人游戏</h2>
        <div className="rounds-pick">
          <div className={rounds === 4 ? 'on' : ''} onClick={() => setRounds(4)}>4 局 · 约 20 分钟</div>
          <div className={rounds === 8 ? 'on' : ''} onClick={() => setRounds(8)}>8 局 · 约 40 分钟</div>
        </div>
        <button className="btn btn-gold" onClick={() => go('game')}>开始</button>
        <span className="btn btn-ghost" style={{ padding: '8px 20px' }} onClick={() => go('')}>返回</span>
      </div>
    );
  }
  return <Home go={go} bgmOn={bgmOn} onToggleBgm={toggleBgm} />;
}
