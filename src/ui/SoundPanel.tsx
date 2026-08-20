import { useEffect, useState } from 'react';
import { setSoundEnabled, setBgmEnabled, getBgm } from '../game/sound.js';

/**
 * 声音设置浮层：音效 / 背景音乐 / 其他玩家（其他玩家仅好友房显示，控制 TRTC 远端音量）
 * 用法：喇叭按钮点击后弹出；点面板外关闭。
 */
export function SoundPanel({ showVoice, voiceOn, onToggleVoice, onClose }: {
  showVoice: boolean;
  voiceOn: boolean;
  onToggleVoice: () => void;
  onClose: () => void;
}) {
  const [sfx, setSfx] = useState<boolean>(() => {
    const stored = localStorage.getItem('qz-mj-sound');
    return stored === null ? true : stored !== '0';
  });
  const [bgm, setBgm] = useState<boolean>(getBgm);
  // 监听全局 bgm 变化(首页/Settings/其他面板改了 → 同步显示)
  useEffect(() => {
    const sync = () => setBgm(getBgm());
    window.addEventListener('bgm-change', sync);
    return () => window.removeEventListener('bgm-change', sync);
  }, []);

  const row = (label: string, on: boolean, onClick: () => void) => (
    <div className="sp-row" onClick={onClick}>
      <span>{label}</span>
      <span className={`sp-toggle ${on ? 'on' : 'off'}`}>{on ? '开 ✓' : '关'}</span>
    </div>
  );

  return (
    <div className="sound-panel" onClick={(e) => e.stopPropagation()}>
      <div className="sp-title">声音设置</div>
      {row('音效', sfx, () => {
        const v = !sfx;
        setSfx(v);
        setSoundEnabled(v);
        try { localStorage.setItem('qz-mj-sound', v ? '1' : '0'); } catch { /* ignore */ }
      })}
      {row('背景音乐', bgm, () => {
        const v = !bgm;
        setBgm(v);
        setBgmEnabled(v); // 内部已写 store + 派发 bgm-change
      })}
      {showVoice && row('其他玩家', voiceOn, onToggleVoice)}
      <div className="sp-close" onClick={onClose}>× 关闭</div>
    </div>
  );
}