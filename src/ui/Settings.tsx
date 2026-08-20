import { useEffect, useState } from 'react';
import { setSoundEnabled, setBgmEnabled, getBgm } from '../game/sound.js';

export function Settings({ go }: { go: (p: string) => void }) {
  const [sound, setSound] = useState<boolean>(() => {
    const stored = localStorage.getItem('qz-mj-sound');
    if (stored !== null) return stored !== '0';
    return true;
  });
  const [bgm, setBgm] = useState<boolean>(getBgm);
  // 监听全局 bgm 变化(面板/首页改了 → 同步显示)
  useEffect(() => {
    const sync = () => setBgm(getBgm());
    window.addEventListener('bgm-change', sync);
    return () => window.removeEventListener('bgm-change', sync);
  }, []);
  useEffect(() => {
    setSoundEnabled(sound);
    try { localStorage.setItem('qz-mj-sound', sound ? '1' : '0'); } catch { /* ignore */ }
    // 音效/背景乐是独立开关，不再联动关 BGM（用户 2026-08-19 实测反馈）
  }, [sound]);
  useEffect(() => {
    // setBgmEnabled 内部已写会话级 store + 派发 bgm-change
    setBgmEnabled(bgm);
  }, [bgm]);
  return (
    <div className="stage simple stage-portrait">
      <span className="back" onClick={() => go('')}>‹ 返回</span>
      <h2>设置</h2>
      <div className="body">
        <div className="row">
          <span>音效</span>
          <span onClick={() => setSound(!sound)} style={{ color: 'var(--gold-light)', cursor: 'pointer' }}>
            {sound ? '开 ✓' : '关'}
          </span>
        </div>
        <div className="row">
          <span>背景音乐</span>
          <span onClick={() => setBgm(!bgm)} style={{ color: 'var(--gold-light)', cursor: 'pointer' }}>
            {bgm ? '开 ✓' : '关'}
          </span>
        </div>
        <div className="row"><span>回合时限</span><span>主回合 30s / 响应 8s</span></div>
      </div>
    </div>
  );
}