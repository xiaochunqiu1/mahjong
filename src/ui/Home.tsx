export function Home({ go, bgmOn, onToggleBgm }: { go: (p: string) => void; bgmOn: boolean; onToggleBgm: () => void }) {
  // 品牌名由构建参数注入（默认开麦麻将；小雅版构建时 VITE_APP_NAME=小雅游金）
  const APP_NAME: string = (import.meta as any).env?.VITE_APP_NAME || '开麦麻将';
  return (
    <div className="stage home stage-portrait">
      <h1><em>{APP_NAME.slice(0, 2)}</em>{APP_NAME.slice(2)}</h1>
      <div className="sub">十 六 张 · 补 花 开 金 · 单 双 三 游</div>
      <nav className="menu">
        <button className="btn btn-gold" onClick={() => go('pregame')}>单人游戏</button>
        <button className="btn btn-sea" onClick={() => go('create')}>创建好友房</button>
        <button className="btn btn-sea" onClick={() => go('join')}>输入房间码</button>
        <div className="menu-row">
          <button className="btn btn-ghost" onClick={() => go('rules')}>规则</button>
          <button className="btn btn-ghost" onClick={() => go('history')}>战绩</button>
        </div>
        <div className="menu-row">
          <button className="btn btn-ghost" onClick={() => go('settings')}>设置</button>
          <button className="btn btn-ghost" onClick={onToggleBgm}>{bgmOn ? '♪ 音乐开' : '♪ 音乐关'}</button>
        </div>
      </nav>
    </div>
  );
}