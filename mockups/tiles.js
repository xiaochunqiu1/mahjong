/**
 * 视觉稿牌面渲染器：按 data-k（kind 编码）把空 .tile 渲染成麻将图案。
 * 筒=圆点阵，条=竹节条阵，万=数字+萬，字牌传统配色。
 * 注意：仍为 CSS 占位稿，终版替换为许可清晰的绘制素材。
 */
(function () {
  var WAN = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
  var WIND = ['东', '南', '西', '北'];
  // 3x3 网格点位（index 0..8）
  var PIPS = {
    1: [4],
    2: [0, 8],
    3: [0, 4, 8],
    4: [0, 2, 6, 8],
    5: [0, 2, 4, 6, 8],
    6: [0, 2, 3, 5, 6, 8],
    7: [0, 2, 3, 4, 5, 6, 8],
    8: [0, 1, 2, 3, 5, 6, 7, 8],
    9: [0, 1, 2, 3, 4, 5, 6, 7, 8]
  };

  function pipGrid(cls, rank, redCenter) {
    var cells = '';
    var on = PIPS[rank];
    for (var i = 0; i < 9; i++) {
      if (on.indexOf(i) >= 0) {
        var red = redCenter && i === 4;
        cells += '<i class="' + cls + (red ? ' red' : '') + '"></i>';
      } else {
        cells += '<i class="off"></i>';
      }
    }
    return '<span class="pip-grid">' + cells + '</span>';
  }

  function render(el) {
    var k = parseInt(el.getAttribute('data-k'), 10);
    if (isNaN(k)) return;
    el.removeAttribute('data-k');
    if (k >= 34) { // 花牌（视觉稿用字+色块占位）
      var F = ['春', '夏', '秋', '冬', '梅', '兰', '竹', '菊'];
      el.innerHTML = '<span class="face flower">' + F[k - 34] + '</span>';
      el.classList.add('flower-tile');
    } else if (k >= 31) { // 中 / 发 / 白
      if (k === 31) el.innerHTML = '<span class="face zhong">中</span>';
      else if (k === 32) el.innerHTML = '<span class="face fa">發</span>';
      else el.innerHTML = '<span class="face bai"><i></i></span>';
    } else if (k >= 27) { // 风
      el.innerHTML = '<span class="face wind">' + WIND[k - 27] + '</span>';
    } else if (k >= 18) { // 筒
      var r = k - 17;
      el.innerHTML = r === 1
        ? '<span class="big-dot"></span>'
        : pipGrid('dot', r, r % 2 === 1);
    } else if (k >= 9) { // 条
      var r2 = k - 8;
      el.innerHTML = r2 === 1
        ? '<span class="big-bar"></span>'
        : pipGrid('bar', r2, r2 % 2 === 1);
    } else { // 万
      el.innerHTML = '<span class="face wan"><b>' + WAN[k] + '</b><em>萬</em></span>';
    }
  }

  function renderAll(root) {
    var list = (root || document).querySelectorAll('.tile[data-k]');
    for (var i = 0; i < list.length; i++) render(list[i]);
  }

  window.MJ_TILES = { render: render, renderAll: renderAll };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { renderAll(); });
  } else {
    renderAll();
  }
})();
