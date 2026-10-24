// tiles.js — 元瓦片(metatile)定义与 tiles.png 图集映射
// 元瓦片编号完全沿用原版(见 smbdis.asm Palette0-3_MTiles 注释):
//   0x00-0x26 (调色板0): 空白/灌木/山丘/树/水管/侧管/旗杆...
//   0x40-0x6d (调色板1): 绳/城堡/砖/实心块/炮台/桥/水岩...
//   0x80-0x89 (调色板2): 云/水/云台/Boss桥
//   0xc0-0xc5 (调色板3): ?块/金币/用过的块/斧头
// 图集 tiles.png: 33列 x 28行, 每格16x16

var TILE_SHEET = { src: "assets/sprites/tiles.png", cell: 16 };
var LEVEL_ROWS = 13;
var HUD_ROWS = 2;

var MT_ART = {}; // 元瓦片 -> [col,row] (tiles.png)
function mtA(id, col, row) { MT_ART[id] = [col, row]; }

// ===== 调色板0 =====
mtA(0x01, -2, -2);                     // 黑块(用程序绘制)
mtA(0x02, 5, 12); mtA(0x03, 6, 12); mtA(0x04, 7, 12); // 灌木 左/中/右
mtA(0x05, 8, 16); mtA(0x06, 9, 16); mtA(0x07, 10, 16); // 山丘左/左下中/中顶
mtA(0x08, 8, 18); mtA(0x09, 9, 18); mtA(0x0a, 10, 18); // 山丘右/右下/中下
mtA(0x0b, 2, 16);                      // 桥栏杆
mtA(0x0c, 6, 16);                      // 锁链
mtA(0x0d, 5, 16); mtA(0x0e, 6, 16); mtA(0x0f, 7, 16); // 树顶(高/矮/高下半)
mtA(0x10, 0, 8); mtA(0x11, 1, 8);      // 水管口(可进入)左/右
mtA(0x12, 0, 8); mtA(0x13, 1, 8);      // 水管口(装饰)左/右
mtA(0x14, 3, 8); mtA(0x15, 4, 8);      // 水管身 左/右
mtA(0x16, 5, 16); mtA(0x17, 6, 16); mtA(0x18, 7, 16); // 树台 左/中/右
mtA(0x19, 8, 12); mtA(0x1a, 9, 12); mtA(0x1b, 10, 12); // 蘑菇台 左/中/右
mtA(0x1c, 5, 8); mtA(0x1d, 6, 8); mtA(0x1e, 5, 8);  // 侧管(顶部) 待校准
mtA(0x1f, 5, 10); mtA(0x20, 6, 10); mtA(0x21, 5, 10); // 侧管(底部)
mtA(0x22, 12, 4);                      // 海草
mtA(0x24, -3, -3);                     // 旗杆球(程序绘制)
mtA(0x25, -3, -3);                     // 旗杆身(程序绘制)

// ===== 调色板1 =====
mtA(0x40, -4, -4);                     // 竖绳(程序绘制)
mtA(0x41, -4, -4);                     // 横绳
mtA(0x42, -4, -4); mtA(0x43, -4, -4);  // 滑轮
mtA(0x45, 8, 20);                      // 城堡顶(垛口)
mtA(0x46, 9, 20);                      // 城堡窗左
mtA(0x47, 8, 20);                      // 城堡砖墙
mtA(0x48, 10, 20);                     // 城堡窗右
mtA(0x49, 8, 22);                      // 城堡顶+砖
mtA(0x4a, 9, 22);                      // 城门顶
mtA(0x4b, 9, 24);                      // 城门底
mtA(0x4c, 5, 18);                      // 绿树桩
mtA(0x4d, 2, 20);                      // 围栏
mtA(0x4e, 5, 18);                      // 树干
mtA(0x4f, 9, 14); mtA(0x50, 9, 14);    // 蘑菇柄 顶/底
mtA(0x51, 12, 0);                      // 砖(带线)
mtA(0x52, 14, 0);                      // 砖(地下)
mtA(0x54, 0, 0);                       // 地面块(裂纹岩)
mtA(0x55, 12, 0); mtA(0x56, 12, 0); mtA(0x57, 12, 0); mtA(0x58, 12, 0); mtA(0x59, 12, 0); // 砖(蘑菇/藤/星/币/1UP)
mtA(0x5a, 14, 0); mtA(0x5b, 14, 0); mtA(0x5c, 14, 0); mtA(0x5d, 14, 0); mtA(0x5e, 14, 0); // 地下砖同上
mtA(0x5f, -1, -1); mtA(0x60, -1, -1);  // 隐藏块: 不渲染
mtA(0x61, 1, 0);                       // 实心3D块(台阶)
mtA(0x62, 2, 8);                       // 城堡白墙(世界8水关地形)
mtA(0x63, 3, 16);                      // 桥板
mtA(0x64, 8, 6); mtA(0x65, 9, 6); mtA(0x66, 10, 6); // 炮台 炮管/顶/底
mtA(0x67, -5, -5);                     // 弹簧占位(实体绘制)
mtA(0x68, 1, 6);
mtA(0x69, 7, 0);                       // 水关绿岩地形
mtA(0x6b, 5, 8); mtA(0x6c, 5, 10);     // 水管(水关横管)
mtA(0x6d, -3, -3);                     // 旗球(残留)

// ===== 调色板2 =====
mtA(0x80, 0, 18); mtA(0x81, 1, 18); mtA(0x82, 2, 18);            // 云 左/中/右
mtA(0x83, 0, 20); mtA(0x84, 1, 20); mtA(0x85, 2, 20);            // 云底 左/中/右
mtA(0x86, 0, 16);                       // 水面波
mtA(0x87, 1, 16);                       // 水
mtA(0x88, 2, 2);                        // 云台块(云关地形)
mtA(0x89, 3, 16);                       // Boss桥

// ===== 调色板3 =====
mtA(0xc0, 0, 2); mtA(0xc1, 0, 2);      // ?块(金币/道具) — 动画帧渲染时替换
mtA(0xc2, 0, 4); mtA(0xc3, 0, 4);      // 金币(水关金币同帧)
mtA(0xc4, 3, 0);                       // 用过的块
mtA(0xc5, 16, 4);                      // 斧头

// ?块/金币动画帧
var Q_FRAMES = [[0, 2], [1, 2], [2, 2], [3, 2]];
var COIN_FRAMES = [[0, 4], [1, 4], [2, 4], [3, 4]];

// 程序绘制瓦片(负坐标标记): 旗杆球/杆, 绳, 黑块, 弹簧占位
var PROC_TILES = {};
function buildProcTiles() {
  function make(key, w, h, draw) {
    var c = document.createElement("canvas");
    c.width = w; c.height = h;
    var g = c.getContext("2d");
    draw(g);
    PROC_TILES[key] = c;
  }
  // 旗杆球: 绿球在16x16顶部中央
  make(0x24, 16, 16, function (g) {
    g.fillStyle = "#80D010"; g.fillRect(6, 3, 4, 4); g.fillRect(5, 4, 6, 2);
    g.fillStyle = "#00A800"; g.fillRect(6, 7, 4, 1);
  });
  // 旗杆身: 4px 绿杆居中
  make(0x25, 16, 16, function (g) {
    g.fillStyle = "#80D010"; g.fillRect(6, 0, 1, 16); g.fillRect(9, 0, 1, 16);
    g.fillStyle = "#00A800"; g.fillRect(7, 0, 2, 16);
  });
  // 竖绳: 2px 白/棕
  make(0x40, 16, 16, function (g) {
    g.fillStyle = "#F8B8B8"; g.fillRect(7, 0, 2, 16);
    g.fillStyle = "#503000"; g.fillRect(7, 2, 2, 1); g.fillRect(7, 6, 2, 1);
    g.fillRect(7, 10, 2, 1); g.fillRect(7, 14, 2, 1);
  });
  make(0x41, 16, 16, function (g) {
    g.fillStyle = "#F8B8B8"; g.fillRect(0, 7, 16, 2);
    g.fillStyle = "#503000"; g.fillRect(2, 7, 1, 2); g.fillRect(6, 7, 1, 2);
    g.fillRect(10, 7, 1, 2); g.fillRect(14, 7, 1, 2);
  });
  make(0x42, 16, 16, function (g) {
    g.fillStyle = "#F8B8B8"; g.fillRect(7, 8, 2, 8);
    g.fillStyle = "#E45C10"; g.fillRect(4, 1, 8, 6); g.fillStyle = "#F8B8B8"; g.fillRect(6, 3, 4, 2);
  });
  make(0x43, 16, 16, function (g) {
    g.fillStyle = "#F8B8B8"; g.fillRect(7, 8, 2, 8);
    g.fillStyle = "#E45C10"; g.fillRect(4, 1, 8, 6); g.fillStyle = "#F8B8B8"; g.fillRect(6, 3, 4, 2);
  });
  make(0x01, 16, 16, function (g) { g.fillStyle = "#000"; g.fillRect(0, 0, 16, 16); });
  make(0x6d, 16, 16, function (g) {
    g.fillStyle = "#80D010"; g.fillRect(5, 8, 6, 6);
    g.fillStyle = "#00A800"; g.fillRect(6, 9, 4, 4);
  });
}

// 绘制一个元瓦片到 ctx (动画帧由调用者替换)
// tilesImg: 已加载的 tiles.png Image
function drawMetatile(ctx, tilesImg, mt, dx, dy, frameOverride, artMap) {
  var AM = artMap || MT_ART;
  var art = frameOverride || AM[mt];
  if (!art) {
    // 程序瓦片
    if (!PROC_TILES[0x25]) buildProcTiles();
    var pc = PROC_TILES[mt];
    if (pc) { ctx.drawImage(pc, dx, dy); return; }
    ctx.strokeStyle = "#f0f"; ctx.strokeRect(dx + 0.5, dy + 0.5, 15, 15);
    return;
  }
  if (art[0] < 0) {
    if (!PROC_TILES[0x25]) buildProcTiles();
    var pc2 = PROC_TILES[mt];
    if (pc2) ctx.drawImage(pc2, dx, dy);
    return;
  }
  ctx.drawImage(tilesImg, art[0] * 16, art[1] * 16, 16, 16, dx, dy, 16, 16);
}

// ---- 实心判定(原版按高2位+下界) ----
var BLOCK_LOW_BOUNDS = [0x10, 0x51, 0x88, 0xc0];
function isSolidMetatile(m) {
  if (m === 0) return false;
  var cat = (m & 0xc0) >> 6;
  return m >= BLOCK_LOW_BOUNDS[cat];
}

function isWaterMetatile(m) { return m === 0x86 || m === 0x87; }
