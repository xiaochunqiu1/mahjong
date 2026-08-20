import { memo } from 'react';

/** kind → 香港麻将 PNG 文件名（public/tiles/，samoheen/mahjong-tiles，Public Domain）
 *  映射：Man=万 characters / Sou=条 bamboos / Pin=筒 circles / 东南西北 / Chun=中(红龙) / Hatsu=發(绿龙) / Haku=白(白龙) / flower-1..8=春夏秋冬梅兰竹菊 */
function tileSvg(kind: number): string {
  if (kind < 9) return 'Man' + (kind + 1);            // 万
  if (kind < 18) return 'Sou' + (kind - 8);           // 条
  if (kind < 27) return 'Pin' + (kind - 17);          // 筒
  if (kind < 31) return ['Ton', 'Nan', 'Shaa', 'Pei'][kind - 27]!; // 东南西北
  if (kind === 31) return 'Chun';                     // 中
  if (kind === 32) return 'Hatsu';                    // 發
  return 'Haku';                                      // 白板
}
function flowerSvg(kind: number): string { return 'flower-' + (kind - 33); } // kind 34-41 → flower-1..8

/** 牌面组件：kind → 香港麻将 PNG 牌面（Public Domain） */
export const TileFace = memo(function TileFace({ kind, small, onClickTile, extraCls, style, selected }: {
  kind: number; small?: boolean; onClickTile?: () => void; extraCls?: string; style?: React.CSSProperties; selected?: boolean;
}) {
  const cls = 'tile' + (small ? ' sm' : '') + (onClickTile ? ' selectable' : '') + (selected ? ' picked' : '') + (extraCls ? ' ' + extraCls : '');
  // 花牌：专用素材（带春夏秋冬/梅兰竹菊图案）
  if (kind >= 34) {
    return (
      <div className={cls + ' flower'} onClick={onClickTile} style={style}>
        <img className="face-img" src={'/tiles/' + flowerSvg(kind) + '.png'} alt="" draggable={false} />
      </div>
    );
  }
  return (
    <div className={cls} onClick={onClickTile} style={style}>
      <img className="face-img" src={'/tiles/' + tileSvg(kind) + '.png'} alt="" draggable={false} />
    </div>
  );
});
