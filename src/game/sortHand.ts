/**
 * 手牌展示排序：万 → 条 → 筒 → 风 → 箭；组内按点数升序、同种多张按实例 id。
 * 金牌（百搭）固定排最前，确保玩家一眼能看到自己的万能牌位置。
 *
 * 输入输出均为 tile 实例 id（保留实例信息，便于在 UI 中识别"刚摸到的牌"）。
 */
export function sortHandForDisplay(hand: number[], goldKind: number): number[] {
  const kind = (t: number) => Math.floor(t / 4);
  const group = (t: number): number => {
    const k = kind(t);
    if (k === goldKind) return -1; // 金牌固定最前
    if (k < 9) return 0;
    if (k < 18) return 1;
    if (k < 27) return 2;
    if (k < 31) return 3;
    return 4;
  };
  return [...hand].sort((a, b) => {
    const ga = group(a);
    const gb = group(b);
    if (ga !== gb) return ga - gb;
    if (kind(a) !== kind(b)) return kind(a) - kind(b);
    return a - b;
  });
}
