import { memo } from 'react';

const FLOWERS = ['春', '夏', '秋', '冬', '梅', '兰', '竹', '菊'];

/** kind → riichi-mahjong-tiles SVG 文件名（public/tiles/，CC0 公有领域） */
function tileSvg(kind: number): string {
  if (kind < 9) return 'Man' + (kind + 1);            // 万
  if (kind < 18) return 'Sou' + (kind - 8);           // 条
  if (kind < 27) return 'Pin' + (kind - 17);          // 筒
  if (kind < 31) return ['Ton', 'Nan', 'Shaa', 'Pei'][kind - 27]!; // 东南西北
  if (kind === 31) return 'Chun';                     // 中
  if (kind === 32) return 'Hatsu';                    // 發
  return 'Haku';                                      // 白
}

/** 牌面组件：kind → 高清 SVG 牌面（riichi-mahjong-tiles，CC0）
 *  花牌无素材 → Front.svg 牌身 + 汉字叠加 */
export const TileFace = memo(function TileFace({ kind, small, onClickTile, extraCls, style }: {
  kind: number; small?: boolean; onClickTile?: () => void; extraCls?: string; style?: React.CSSProperties;
}) {
  const cls = 'tile' + (small ? ' sm' : '') + (onClickTile ? ' selectable' : '') + (extraCls ? ' ' + extraCls : '');
  if (kind >= 34) {
    // 花牌：Front 牌身 + 汉字（riichi 素材无花牌）
    return (
      <div className={cls + ' flower'} onClick={onClickTile} style={style}>
        <img className="face-img" src="/tiles/Front.svg" alt="" draggable={false} />
        <span className="face-flower">{FLOWERS[kind - 34]}</span>
      </div>
    );
  }
  // 白板（kind 33）SVG 内只有边框无字，加一个中心"白"字让牌面有内容（其他字牌 SVG 自带汉字）
  if (kind === 33) {
    return (
      <div className={cls + ' haku'} onClick={onClickTile} style={style}>
        <img className="face-img" src="/tiles/Haku.svg" alt="" draggable={false} />
        <span className="haku-label">白</span>
      </div>
    );
  }
  return (
    <div className={cls} onClick={onClickTile} style={style}>
      <img className="face-img" src={'/tiles/' + tileSvg(kind) + '.svg'} alt="" draggable={false} />
    </div>
  );
});
