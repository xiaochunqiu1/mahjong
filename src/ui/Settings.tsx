import { useEffect, useState } from 'react';
import { setSoundEnabled, isSoundEnabled, setBgmEnabled, isBgmEnabled } from '../game/sound.js';

export function Settings({ go }: { go: (p: string) => void }) {
  const [sound, setSound] = useState<boolean>(() => {
    const stored = localStorage.getItem('qz-mj-sound');
    if (stored !== null) return stored !== '0';
    return true;
  });
  const [bgm, setBgm] = useState<boolean>(() => {
    const stored = localStorage.getItem('qz-mj-bgm');
    if (stored !== null) return stored !== '0';
    return true; // 默认开
  });
  useEffect(() => {
    setSoundEnabled(sound);
    try { localStorage.setItem('qz-mj-sound', sound ? '1' : '0'); } catch { /* ignore */ }
    if (!sound && bgm) setBgm(false); // 关 SFX 时联动关 BGM
  }, [sound]);
  useEffect(() => {
    setBgmEnabled(bgm);
    try { localStorage.setItem('qz-mj-bgm', bgm ? '1' : '0'); } catch { /* ignore */ }
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