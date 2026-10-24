// level.js — 原版关卡流解码器(忠实翻译 smbdis 的 ProcessAreaData / ProcessEnemyData)
// 将对象流+敌人流一次性解码为整关地图(等价于原版随卷轴逐列渲染的最终结果)

var LEVEL_ROWS = 13;      // 玩法区 13 行(0-12), 屏幕 y = row*16+32
var HUD_ROWS = 2;

function Level() {
  this.width = 16;                  // tile 列数(动态增长)
  this.map = new Uint8Array(16 * LEVEL_ROWS); // 元瓦片编码
  this.metatile = [];               // 同 map, 但保留不可见内容? map即最终
  this.enemies = [];                // {x, y(像素,玩法区坐标), id}
  this.warps = [];                  // {x, y, destArea(byte), destPage, world}
  this.cannons = [];                // 炮台 {x, y}
  this.flagpole = null;             // {x(像素)}
  this.castleX = -1;                // 城堡位置(tile列)
  this.starflagX = -1;              // 城堡上升旗位置(像素)
  this.bridges = [];                // Boss 桥 {row, colStart, len}
  this.loops = [];                  // 城堡回退指令 {page}
  this.frenzy = [];                 // 刷怪 {col, type}
  this.scrollLock = false;
  this.scrollLockAt = [];           // 触发列
  this.warpZone = 0;                // 0无, 1/2/3=数字组合
  this.startType = 0;               // 入场方式(头字节 bit3-5)
  this.timerSetting = 0;            // 0-3
  this.style = 0;                   // AreaStyle 0地面 1地下 2城堡
  this.areaType = 0;                // 0水 1地面 2地下 3城堡
  this.cloudOverride = false;
  this.ceilColor = 0;               // 背景色控制(4-7)
  this.foreScenery = 0;
  this.backScenery = 0;
  this.terrain = 0;
  this.piranhas = [];               // 水管食人花 {x,y(像素)}
}

Level.prototype.at = function (col, row) {
  if (col < 0 || col >= this.width || row < 0 || row >= LEVEL_ROWS) return 0;
  return this.map[row * this.width + col];
};
Level.prototype.set = function (col, row, mt) {
  if (col < 0 || row < 0 || row >= LEVEL_ROWS) return;
  while (col >= this.width) this.grow();
  this.map[row * this.width + col] = mt;
};
Level.prototype.grow = function () {
  var w2 = this.width + 16;
  var m2 = new Uint8Array(w2 * LEVEL_ROWS);
  for (var r = 0; r < LEVEL_ROWS; r++) {
    for (var c = 0; c < this.width; c++) {
      m2[r * w2 + c] = this.map[r * this.width + c];
    }
  }
  this.width = w2; this.map = m2;
};

// ---------- 元瓦片绘制辅助(等价 RenderUnderPart 的保留规则) ----------
Level.prototype.renderUnder = function (col, startRow, mt, height) {
  for (var i = 0; i < height; i++) {
    var row = startRow + i;
    if (row >= LEVEL_ROWS) break;
    var cur = this.at(col, row);
    if (cur === 0) { this.set(col, row, mt); continue; }
    if (cur === 0x17 || cur === 0x1a) continue;       // 树/蘑菇台中段
    if (cur === 0xc0) { this.set(col, row, mt); continue; }
    if (cur >= 0xc0) continue;
    if (cur === 0x54 && mt === 0x50) continue;
    this.set(col, row, mt);
  }
};

// ---------- 场景数据 ----------
var TB = null; // SMB_TABLES 引用

function sceneryItem(idx) { // idx 1-12 → 3 元瓦片
  return [TB.BackSceneryMetatiles[(idx - 1) * 3],
          TB.BackSceneryMetatiles[(idx - 1) * 3 + 1],
          TB.BackSceneryMetatiles[(idx - 1) * 3 + 2]];
}

// ---------- 主解码入口 ----------
// worldNumber 0-7, areaNumber: 0-3 主关卡, 4+ 奖励区索引
var AREA_ADDR_OFFSETS = null; // 拼接的世界区域表(惰性)

function decodeLevelByPointer(areaPointer, worldNumber, DS) {
  DS = DS || DATASETS.smb1;
  TB = DS.tables;
  var useAD = DS.id === "smb2j" && worldNumber >= 9;
  var TBW = useAD ? {
    EnemyDataAddrLow: DS.worldTables.ADEnemyDataAddrLow,
    EnemyDataAddrHigh: DS.worldTables.ADEnemyDataAddrHigh,
    AreaDataAddrLow: DS.worldTables.ADAreaDataAddrLow,
    AreaDataAddrHigh: DS.worldTables.ADAreaDataAddrHigh,
    EnemyAddrHOffsets: DS.worldTables.ADEnemyAddrHOffsets || DS.worldTables.EnemyAddrHOffsets,
    AreaDataHOffsets: DS.worldTables.ADAreaDataHOffsets || DS.worldTables.AreaDataHOffsets,
  } : {
    EnemyAddrHOffsets: DS.worldTables.MainEnemyAddrHOffsets || DS.worldTables.EnemyAddrHOffsets,
    AreaDataHOffsets: DS.worldTables.MainAreaDataHOffsets || DS.worldTables.AreaDataHOffsets,
    EnemyDataAddrLow: DS.worldTables.EnemyDataAddrLow,
    EnemyDataAddrHigh: DS.worldTables.EnemyDataAddrHigh,
    AreaDataAddrLow: DS.worldTables.AreaDataAddrLow,
    AreaDataAddrHigh: DS.worldTables.AreaDataAddrHigh,
  };
  var BYP = DS.BY_PTR || BY_PTR;
  var L = new Level();
  L.dataset = DS.id;
  L._worldNumber = worldNumber === undefined ? 0 : worldNumber;
  L._areaNumber = 0;
  L.areaPointer = areaPointer;

  var areaType = (areaPointer >> 5) & 3;
  L.areaType = areaType;
  var lidx = areaPointer & 0x1f;

  // -- 敌人/地形数据指针 --
  var eBase = TBW.EnemyAddrHOffsets[areaType];
  var eOff = (eBase + lidx) & 0xff;
  var ePtr = TBW.EnemyDataAddrLow[eOff] | (TBW.EnemyDataAddrHigh[eOff] << 8);
  var aBase = TBW.AreaDataHOffsets[areaType];
  var aOff = (aBase + lidx) & 0xff;
  var aPtr = TBW.AreaDataAddrLow[aOff] | (TBW.AreaDataAddrHigh[aOff] << 8);

  var eData = DS.LEVEL_DATA[BYP[ePtr]].data;
  var aData = DS.LEVEL_DATA[BYP[aPtr]].data;

  // -- 关卡头 --
  var h1 = aData[0], h2 = aData[1];
  var fg = h1 & 7;
  if (fg >= 4) { L.ceilColor = fg; L.foreScenery = 0; } else L.foreScenery = fg;
  L.startType = (h1 >> 3) & 7;
  L.timerSetting = (h1 >> 6) & 3;
  L.terrain = h2 & 0x0f;
  L.backScenery = (h2 >> 4) & 3;
  var styleBits = (h2 >> 6) & 3;
  if (styleBits === 3) { L.cloudOverride = true; L.style = 0; }
  else L.style = styleBits;

  // -- 解码地形对象流, 逐页逐列 --
  decodeAreaObjects(L, aData, worldNumber, DS);

  // -- 解码敌人流 --
  decodeEnemyData(L, eData, worldNumber, DS);

  // 裁剪宽度到实际使用(留一页余量)
  return L;
}

// ---------- 地形对象流解码(逐列状态机) ----------
function decodeAreaObjects(L, data, worldNumber, DS) {
  var objects = [];       // 解析出的对象 {off, page, kind...}
  var page = 0;
  var stream = [];
  // 先完整解析一遍流, 记录每个对象的字节偏移与所属页
  var p = 2; // 跳过关卡头
  var pageSel = false;
  while (p < data.length) {
    var b1 = data[p];
    if (b1 === 0xfd) break;
    var b2 = data[p + 1];
    var row = b1 & 0x0f, col = (b1 >> 4) & 0x0f;
    var entry = { off: p, col: col, row: row, b1: b1, b2: b2, page: page, extra: [] };
    // 页递增
    if ((b2 & 0x80) && !pageSel) { page++; pageSel = true; }
    entry.page = page;
    // 行0xE: 三字节
    if (row === 0x0e) entry.extra.push(data[p + 2]);
    // 行0xD 页控制
    if (row === 0x0d && !(b2 & 0x40)) {
      page = b2 & 0x1f; pageSel = true;
      entry.pageCtrl = true;
      entry.page = page;
    }
    // 行0xF 或 行0xE 时 AreaObjectPageLoc 由 d7 控制, 已处理
    stream.push(entry);
    p += (row === 0x0e) ? 3 : 2;
    pageSel = false;
  }
  // 注意: 页递增标志语义为"该对象位于新页", 与原版一致(每对象一次)
  // 重新按规则计算页码: 原版 AreaObjectPageLoc 遇 d7 置位才++, 页控制直接赋值
  {
    var pg = 0, sel = false;
    for (var i = 0; i < stream.length; i++) {
      var e = stream[i];
      var b2 = e.b2;
      if ((b2 & 0x80) && !sel) { pg++; sel = true; }
      if ((e.row & 0x0f) === 0x0d && !(b2 & 0x40)) { pg = b2 & 0x1f; sel = true; }
      e.page = pg;
      sel = false;
    }
  }

  // 逐列渲染
  var maxPage = 0;
  for (var i = 0; i < stream.length; i++) {
    var e = stream[i];
    var isPageCtrl = (e.row === 0x0d) && !(e.b2 & 0x40);
    if (!isPageCtrl && e.page > maxPage) maxPage = e.page;
  }
  var totalCols = (maxPage + 2) * 16;
  window.__dbg = "objs" + stream.length + " maxp" + maxPage + " len" + data.length + " " + (window.__ptr||"");

  // 活动对象状态(带长度计数)
  var active = [];  // {entry, length, drawnCol}
  var si = 0;
  var stairControl = null;

  for (var col = 0; col < totalCols; col++) {
    var pageLoc = col >> 4, colPos = col & 15;

    // 场景列缓冲 — 先算进临时行数组, 再按原版顺序写入
    var colBuf = new Array(LEVEL_ROWS).fill(0);

    // --- 背景装饰 ---
    if (L.backScenery > 0) {
      var pg3 = pageLoc % 3;
      var bsOff = TB.BSceneDataOffsets[L.backScenery - 1];
      var b = TB.BackSceneryData[bsOff + pg3 * 16 + colPos];
      if (b) {
        var startRow = (b >> 4) & 0x0f;
        var idx = b & 0x0f;
        var tiles3 = sceneryItem(idx);
        for (var k = 0; k < 3 && startRow + k < 0x0b; k++) {
          colBuf[startRow + k] = tiles3[k];
        }
      }
    }
    // --- 前景装饰 ---
    if (L.foreScenery > 0) {
      var fsOff = TB.FSceneDataOffsets[L.foreScenery - 1];
      for (var r = 0; r < LEVEL_ROWS; r++) {
        var v = TB.ForeSceneryData[fsOff + colPos * 13 + r];
        if (v) colBuf[r] = v;
      }
    }
    // --- 地形(地面) ---
    var terrainMt;
    if (L.areaType === 0 && worldNumber === 7) terrainMt = 0x62; // 水下世界8用城堡墙
    else terrainMt = TB.TerrainMetatiles[L.areaType];
    if (L.cloudOverride) terrainMt = 0x88;
    var bits = TB.TerrainRenderBits[L.terrain * 2] | 0;
    var bits2 = TB.TerrainRenderBits[L.terrain * 2 + 1] | 0;
    for (var r2 = 0; r2 < LEVEL_ROWS; r2++) {
      var bitVal = (r2 < 8) ? ((bits >> r2) & 1) : ((bits2 >> (r2 - 8)) & 1);
      if (L.cloudOverride && r2 > 0) {
        // 云关: 除天花板行外仅 d3 位
        bitVal = (r2 === 0) ? bitVal : (((bits2 >> 3) & 1) && r2 === 12) ? 1 : 0;
        // 原版逻辑: 非0行只保留 d3(第11行)
        if (r2 !== 0) bitVal = (r2 === 11) ? ((bits2 >> 3) & 1) : 0;
      }
      if (bitVal) {
        var mt = terrainMt;
        if (L.areaType === 2 && r2 >= 0x0b) mt = 0x54; // 地下底两行用地面块
        colBuf[r2] = mt;
      }
    }

    // 写入地图(先场景/地形)
    for (var r3 = 0; r3 < LEVEL_ROWS; r3++) if (colBuf[r3]) L.set(col, r3, colBuf[r3]);

    // --- 对象 ---
    // 拉取新对象(流序): 页到达即可激活
    while (si < stream.length && stream[si].page <= pageLoc) {
      var en = stream[si++];
      var isPC = (en.row === 0x0d) && !(en.b2 & 0x40);
      if (isPC) continue; // 页控制已处理
      if (en.row === 0x0e && !(en.b2 & 0x40)) {
        // 三字节: 入口管(换区) — 无渲染
        // b2 = 目标 AreaPointer, b3: bit7-5 world 匹配, bit4-0 页
        L.warps.push({
          x: en.col * 16, y: en.row * 16, col: en.col,
          destArea: en.b2 & 0x7f, destPage: en.extra[0] & 0x1f,
          worldCond: (en.extra[0] >> 5) & 7
        });
        continue;
      }
      active.push({ e: en, length: -1, state: {} });
    }

    // 渲染活动对象在本列的部分(仅当渲染列已到达对象起始列)
    for (var ai = 0; ai < active.length; ai++) {
      var a = active[ai];
      var aoc = a.e.page * 16 + a.e.col;
      if (col < aoc) continue;
      renderObjectColumn(L, a, col, pageLoc, colPos, worldNumber);
      if (a.done) active.splice(ai--, 1);
    }

    // 楼梯状态在 renderObjectColumn 内以 level 级别维护
  }

  // 裁剪宽度
  L.widthUsed = totalCols;
}

function decodeLevel(worldNumber, areaNumber, prevTimer, DS) {
  DS = DS || DATASETS.smb1;
  var WT = DS.worldTables;
  var useAD = DS.id === "smb2j" && worldNumber >= 9;
  var addr = useAD
    ? [].concat(WT.WorldAAreas || [], WT.WorldBAreas || [], WT.WorldCAreas || [], WT.WorldDAreas || [])
    : [].concat(WT.World1Areas || [], WT.World2Areas || [], WT.World3Areas || [], WT.World4Areas || [],
        WT.World5Areas || [], WT.World6Areas || [], WT.World7Areas || [], WT.World8Areas || [], WT.World9Areas || []);
  var off = (useAD ? 0 : worldNumber) + areaNumber;
  var L = decodeLevelByPointer(addr[off], worldNumber, DS);
  L._areaNumber = areaNumber;
  return L;
}

// 单个对象在当前列的渲染(等价 RunAObj 分派 + 每列递进)
function renderObjectColumn(L, a, col, pageLoc, colPos, worldNumber, DS) {
  var e = a.e, row = e.row, b2 = e.b2;
  var nyb = b2 & 0x0f;               // 低半字节: 长度/高度
  var type = (b2 >> 4) & 7;          // d6-4
  var S = a.state;
  var objCol = e.col;                // 对象起始列(页内)
  var absObjCol = e.page * 16 + objCol;

  // 对象激活列: absObjCol(树/蘑菇等多列对象从此列开始)
  // 多列对象: 只有 col >= absObjCol 且 length>0 才绘制

  function finish() { a.done = true; }

  // ---- 行分组 ----
  if (row <= 0x0b) {
    // 普通行
    if (type === 0) {
      // 小对象
      var subtype = nyb;
      runSmallObject(L, a, col, absObjCol, row, subtype, finish, worldNumber, DS);
    } else {
      // 大对象 1-7
      runLargeObject(L, a, col, absObjCol, row, type, nyb, finish, worldNumber, DS);
    }
  } else if (row === 0x0c) {
    // 行12: 特殊
    var t2 = type + 8;
    runRow12Object(L, a, col, absObjCol, t2, type, nyb, finish, DS);
  } else if (row === 0x0d) {
    // 行13 特殊对象(d6=1): case = (b2&0x3f)+34
    var val = (b2 & 0x3f);
    var cs = val + 34;
    runRow13Object(L, a, col, absObjCol, cs, val, nyb, finish, worldNumber, DS);
  } else if (row === 0x0e) {
    // 行14: 改属性(2字节+extra) — 一次性
    var nb = b2;
    if (!(nb & 0x40)) { /* 已在 warps 处理 */ }
    else {
      if (nb & 0x40) {
        var fg2 = nb & 7;
        if (fg2 >= 4) L.ceilColor = fg2; else L.foreScenery = fg2;
      }
    }
    finish();
  } else {
    // 行15: case = type + 16
    runRow15Object(L, a, col, absObjCol, type + 16, type, nyb, finish, worldNumber, DS);
  }
}

// 小对象: case = subtype+22 → 数据集分派表名称; 均在对象自身列渲染一次
function runSmallObject(L, a, col, absObjCol, row, subtype, finish, worldNumber, DS) {
  var c = absObjCol;
  var cs = subtype + 22;
  var D = DS || DATASETS.smb1;
  var name = D.dispatch[cs];
  var T = TB;
  switch (name) {
    case "QuestionBlock": {
      // ?块/隐藏块: 元瓦tile直接由分表决定(隐藏内容在 SMB2J 中也是不可见块)
      var idx;
      if (D.id === "smb2j") idx = subtype;          // SMB2J: subtype 直接索引(0-6)
      else idx = (cs === 24) ? 2 : (cs - 22);        // SMB1: 0=道具 1=币 (24为隐藏币)
      var mt = T.BrickQBlockMetatiles[idx];
      L.set(c, row, mt); finish(); break;
    }
    case "Hidden1UpBlock":
      L.set(c, row, D.id === "smb2j" ? 0x5f : 0x60); finish(); break;
    case "BrickWithItem": case "BrickWithCoins": {
      var adder = (L.areaType === 1) ? 0 : (D.id === "smb2j" ? 6 : 5);
      var mtb = T.BrickQBlockMetatiles[adder + subtype];
      L.set(c, row, mtb); finish(); break;
    }
    case "WaterPipe": runWaterPipe(L, c, row); finish(); break;
    case "EmptyBlock": L.set(c, row, D.id === "smb2j" ? 0xc5 : 0xc4); finish(); break;
    case "Jumpspring": runSpring(L, c, row); finish(); break;
    case "IntroPipe": runIntroPipe(L, a, col, absObjCol, row); if (col >= absObjCol + 2) finish(); break;
    case "FlagpoleObject": runFlagpole(L, c, row, absObjCol); finish(); break;
    case "AxeObj": L.set(c, row, D.id === "smb2j" ? 0xc6 : 0xc5); finish(); break;
    case "ChainObj": L.set(c, row, 0x0c); finish(); break;
    case "UpsideDownPipe_High": case "UpsideDownPipe_Low":
      runUpsideDownPipe(L, c, row, name === "UpsideDownPipe_High" ? 1 : 4, subtype);
      finish(); break;
    case "WindOn": L.wind = true; finish(); break;
    case "WindOff": L.wind = false; finish(); break;
    default: finish();
  }
}

// 倒挂水管(SMB2J): 从天花板垂下, 高nyb+1, 可带倒食人花
function runUpsideDownPipe(L, col, row, startRow, subtype) {
  var height = (subtype & 0x07) + 1;
  var VP = TB.VerticalPipeData;
  // 顶(倒) = 常规底反过来: 用 0x14/0x15 翻转绘制由渲染层处理; 这里以管顶编码近似
  L.set(col, startRow, 0x10 + (L.enterableUD ? 2 : 0));
  for (var i = 1; i < height; i++) {
    L.set(col, startRow + i, 0x14);
  }
  L.upsideDownPipes = L.upsideDownPipes || [];
  L.upsideDownPipes.push({ x: col * 16, y: startRow * 16, height: height });
}

// 大对象(类型1-7)
function runLargeObject(L, a, col, absObjCol, row, type, nyb, finish, worldNumber, DS) {
  var S = a.state;
  if (type === 1) {
    // AreaStyleObject: 树台(地面/云) / 蘑菇台(地下) / 炮台(城堡)
    if (L.style === 0) {
      // 树台
      if (S.len === undefined) { S.len = nyb + 1; S.i = 0; }
      if (col < absObjCol) return;
      if (S.i < S.len) {
        var mt = S.i === 0 ? 0x16 : (S.i === S.len - 1 ? 0x18 : 0x17);
        L.set(col, row, mt);
        // 树下
        L.renderUnder(col, row + 1, 0x4c, LEVEL_ROWS - row - 1);
        S.i++;
      }
      if (S.i >= S.len) finish();
    } else if (L.style === 1) {
      // 蘑菇台
      if (S.len === undefined) { S.len = nyb + 1; S.i = 0; S.half = (S.len / 2) | 0; }
      if (col < absObjCol) return;
      if (S.i < S.len) {
        var mt2 = S.i === 0 ? 0x19 : (S.i === S.len - 1 ? 0x1b : 0x1a);
        L.set(col, row, mt2);
        if (S.i === S.half && S.len > 1 && S.len % 2 === 1) {
          // 中央蘑菇柄
          L.renderUnder(col, row + 1, 0x4f, 1);
          L.renderUnder(col, row + 2, 0x50, LEVEL_ROWS - row - 2);
        }
        S.i++;
      }
      if (S.i >= S.len) finish();
    } else {
      // 炮台
      if (S.len === undefined) { S.len = nyb + 1; S.i = 0; }
      if (col < absObjCol) return;
      if (S.i < S.len) {
        var mt3 = S.i === 0 ? 0x64 : (S.i === 1 ? 0x65 : 0x66);
        if (S.i === 0) L.set(col, row, mt3);
        else L.renderUnder(col, row + S.i - 0, 0x66, 1);
        // 更准确: 第一行0x64, 第二行0x65, 其余0x66向下
        S.i++;
      }
      if (S.i >= S.len) finish();
      // 记录炮台
      if (col === absObjCol) L.cannons.push({ x: absObjCol * 16, y: row * 16 });
    }
    return;
  }
  var metatiles = {
    2: brickMetatile(L, DS), 3: solidMetatile(L, DS), 4: coinMetatile(L, DS),
    5: brickMetatile(L, DS), 6: solidMetatile(L, DS),
  };
  if (type === 7 || (type === 0 && false)) {
    runPipe(L, a, col, absObjCol, row, nyb, finish, worldNumber);
    return;
  }
  var mt = metatiles[type];
  if (mt === undefined) { finish(); return; }
  if (S.len === undefined) { S.len = nyb + 1; S.i = 0; }
  if (col < absObjCol) return;
  if (S.i < S.len) {
    if (type === 2 || type === 3 || type === 4) {
      // 水平排
      L.renderUnder(col, row, mt, 1);
    } else {
      // 垂直列(type 5/6): 从起始行向下 nyb+1
      if (col === absObjCol) {
        L.renderUnder(col, row, mt, nyb + 1);
        finish();
      }
    }
    S.i++;
  }
  if (S.i >= S.len) finish();
}

function brickMetatile(L, DS) {
  var T = (DS && DS.tables) ? DS.tables : SMB_TABLES;
  if (L.cloudOverride) return T.BrickMetatiles[4];
  return T.BrickMetatiles[L.areaType];
}
function solidMetatile(L, DS) { var T = (DS && DS.tables) ? DS.tables : SMB_TABLES; return T.SolidBlockMetatiles[L.areaType]; }
function coinMetatile(L, DS) { var T = (DS && DS.tables) ? DS.tables : SMB_TABLES; return T.CoinMetatileData[L.areaType]; }

// 水管: 水平2列, 高 nyb+1, d3=可进入
function runPipe(L, a, col, absObjCol, row, nyb, finish, worldNumber) {
  var S = a.state;
  var enterable = (a.e.b2 & 0x08) ? true : false;
  if (col < absObjCol) return;
  if (S.step === undefined) { S.step = 0; S.height = (nyb & 7) + 1; }
  if (S.step >= 2) { finish(); return; }
  var y = S.step === 0 ? 1 : 0; // 原版: 首列 leftover=1, 次列0
  var topIdx = enterable ? y : y + 4;
  var bodyIdx = enterable ? y + 2 : y + 4 + 2;
  var VP = TB.VerticalPipeData;
  L.set(col, row, VP[topIdx]);
  L.renderUnder(col, row + 1, VP[bodyIdx], S.height - 1);
  // 食人花: 世界1-1 不生成(原版规则)
  if (S.step === 0 && !(worldNumber === 0 && L._areaNumber === 0)) {
    L.piranhas.push({ x: absObjCol * 16 + 8, y: row * 16 });
  }
  S.step++;
  if (S.step >= 2) finish();
}

function runWaterPipe(L, col, row) {
  L.set(col, row, 0x6b);
  L.set(col, row + 1, 0x6c);
}

function runSpring(L, col, row) {
  L.set(col, row, 0x67);
  L.set(col, row + 1, 0x68);
  L.springs = L.springs || [];
  L.springs.push({ x: col * 16, y: row * 16, col: col, row: row });
}

// 入口管(朝左/右的侧向管, 3列宽)
function runIntroPipe(L, a, col, absObjCol, row) {
  var S = a.state;
  if (S.step === undefined) { S.step = 0; }
  if (col < absObjCol) return;
  var sp = TB.SidePipeTopPart, sb = TB.SidePipeBottomPart;
  var shaft = TB.SidePipeShaftData;
  if (S.step < 3) {
    var i = S.step;
    // 竖直部分随列绘制: 原版按水平偏移绘制侧管
    // side pipe: 数据按列(3列), 每列画竖直轴+顶/底
    if (shaft[i] !== 0) {
      // 竖直轴
      L.renderUnder(col, 0, shaft[i], row - 1);
    }
    L.set(col, row, sp[i]);
    L.set(col, row + 1, sb[i]);
    S.step++;
  } else {
    finishObj(a);
  }
}
function finishObj(a) { a.done = true; }

// 旗杆
function runFlagpole(L, col, row, absObjCol) {
  L.set(col, 0, 0x24);
  L.renderUnder(col, 1, 0x25, 9);
  L.set(col, 10, 0x61);
  if (col === absObjCol) {
    L.flagpole = { x: absObjCol * 16, centerX: absObjCol * 16 + 8 };
  }
}

// 行12对象: case = type+8
function runRow12Object(L, a, col, absObjCol, cs, type, nyb, finish) {
  var S = a.state;
  switch (cs) {
    case 8: // 坑
      if (S.len === undefined) S.len = nyb + 1;
      if (col < absObjCol) return;
      if (S.i === undefined) S.i = 0;
      if (S.i < S.len) {
        // 清除地形两行
        L.set(col, 11, 0); L.set(col, 12, 0);
        S.i++;
      } else finish();
      break;
    case 9: // 滑轮绳
      if (col === absObjCol) {
        var pr = TB.PulleyRopeMetatiles;
        // 左滑轮-绳-右滑轮: 按长度
        if (S.len === undefined) { S.len = nyb + 1; S.i = 0; }
        if (col < absObjCol) return;
        if (S.i < S.len) {
          var mt = S.i === 0 ? pr[0] : (S.i === S.len - 1 ? pr[2] : pr[1]);
          L.set(col, 0, mt);
          S.i++;
        } else finish();
      } else {
        if (S.len === undefined) { S.len = nyb + 1; S.i = 0; }
        if (col < absObjCol) return;
        if (S.i < S.len) {
          var mt2 = S.i === 0 ? TB.PulleyRopeMetatiles[0] :
            (S.i === S.len - 1 ? TB.PulleyRopeMetatiles[2] : TB.PulleyRopeMetatiles[1]);
          L.set(col, 0, mt2);
          S.i++;
        } else finish();
      }
      break;
    case 10: runBridge(L, a, col, absObjCol, 6, nyb, finish); break; // 高桥
    case 11: runBridge(L, a, col, absObjCol, 7, nyb, finish); break; // 中桥
    case 12: runBridge(L, a, col, absObjCol, 9, nyb, finish); break; // 低桥
    case 13: // 水坑
      if (S.len === undefined) { S.len = nyb + 1; S.i = 0; }
      if (col < absObjCol) return;
      if (S.i < S.len) {
        L.set(col, 10, 0x86);
        L.renderUnder(col, 11, 0x87, 2);
        S.i++;
      } else finish();
      break;
    case 14: runQRow(L, a, col, absObjCol, 3, nyb, finish); break; // 高?排
    case 15: runQRow(L, a, col, absObjCol, 7, nyb, finish); break; // 低?排
    default: finish();
  }
}

function runBridge(L, a, col, absObjCol, row, nyb, finish) {
  var S = a.state;
  if (S.len === undefined) { S.len = nyb + 1; S.i = 0; }
  if (col < absObjCol) return;
  if (S.i < S.len) {
    L.set(col, row, 0x0b);       // 栏杆
    L.renderUnder(col, row + 1, 0x63, 1); // 桥板
    S.i++;
  } else finish();
}

function runQRow(L, a, col, absObjCol, row, nyb, finish) {
  var S = a.state;
  if (S.len === undefined) { S.len = nyb + 1; S.i = 0; }
  if (col < absObjCol) return;
  if (S.i < S.len) {
    L.set(col, row, 0xc0);
    S.i++;
  } else finish();
}

// 行13对象: case = val+34 → 名称分派
function runRow13Object(L, a, col, absObjCol, cs, val, nyb, finish, worldNumber, DS) {
  var D = DS || DATASETS.smb1;
  var name = D.dispatch[cs];
  switch (name) {
    case "IntroPipe": runIntroPipe(L, a, col, absObjCol, val); if (col >= absObjCol + 3) finish(); break;
    case "FlagpoleObject": runFlagpole(L, col, 0, absObjCol); finish(); break;
    case "AxeObj": L.set(col, 8, D.id === "smb2j" ? 0xc6 : 0xc5); finish(); break;
    case "ChainObj": L.set(col, val, 0x0c); finish(); break;
    case "CastleBridgeObj": runCastleBridge(L, a, col, absObjCol, finish); break;
    case "ScrollLockObject_Warp":
      L.warpZone = (worldNumber === 0) ? 1 : ((L.areaType === 1) ? 2 : 3);
      L.scrollLockAt.push(col);
      L.scrollLock = true;
      L.scrollZoneCol = col;
      finish(); break;
    case "ScrollLockObject":
      L.scrollLockAt.push(col);
      L.scrollLock = true;
      finish(); break;
    case "AreaFrenzy": L.frenzy.push({ col: col, type: 'flyingCheep' }); finish(); break;
    case "LoopCmdE": L.loops.push({ col: col }); finish(); break;
    case "WindOn": L.wind = true; finish(); break;
    case "WindOff": L.wind = false; finish(); break;
    default: finish();
  }
}

function runCastleBridge(L, a, col, absObjCol, finish) {
  var S = a.state;
  if (S.len === undefined) { S.len = 13; S.i = 0; }
  if (col < absObjCol) return;
  if (S.i < S.len) {
    L.set(col, 8, 0x89); // Boss桥板
    S.i++;
  } else finish();
}

// 行15对象: case = type+16
function runRow15Object(L, a, col, absObjCol, cs, type, nyb, finish, worldNumber, DS) {
  switch (cs) {
    case 16: // 无尽绳
      if (col === absObjCol) L.renderUnder(col, 0, 0x40, LEVEL_ROWS);
      finish(); break;
    case 17: // 平衡绳
      if (col === absObjCol) {
        for (var r = 1; r < LEVEL_ROWS; r++) L.set(col, r, 0x44);
        L.balances = L.balances || [];
        L.balances.push({ col: col, row: nyb });
      }
      finish(); break;
    case 18: runCastle(L, a, col, absObjCol, nyb, finish, worldNumber); break;
    case 19: runStairs(L, a, col, absObjCol, nyb, finish); break;
    case 20: // 出口管(侧向)
      runExitPipe(L, a, col, absObjCol, nyb, finish); break;
    case 21: // 旗顶球(残留)
      L.renderUnder(col, 2, 0x6d, nyb + 1); finish(); break;
    case 22: case 23: {
      var nm = DS.dispatch[cs];
      if (nm === "UpsideDownPipe_High" || nm === "UpsideDownPipe_Low") {
        runUpsideDownPipe(L, col, nyb, nm === "UpsideDownPipe_High" ? 1 : 4, type);
      } else {
        L.set(col, nyb, cs === 22 ? 0xc1 : 0xc0);
      }
      finish(); break;
    }
    default: finish();
  }
}

// 楼梯: nyb+1 阶, 每阶升高1, 从左到右上升
function runStairs(L, a, col, absObjCol, nyb, finish) {
  var S = a.state;
  if (S.step === undefined) { S.step = 0; S.total = nyb + 1; }
  if (col < absObjCol) return;
  if (S.step < S.total) {
    var height = S.total - S.step;
    var row = 12 - height + 1;
    L.renderUnder(col, row, 0x61, height);
    S.step++;
  } else finish();
}

// 城堡(5列宽, nyb选择造型)
function runCastle(L, a, col, absObjCol, nyb, finish, worldNumber) {
  var S = a.state;
  if (S.step === undefined) {
    S.step = 0; S.len = 5;
    S.startRow = nyb; // 0=高城堡起始行
    L.castleX = absObjCol;
  }
  if (col < absObjCol) return;
  if (S.step < S.len) {
    var CM = TB.CastleMetatiles;
    // 原版: 每列从 startRow 画到 10, 数据按列偏移
    var y = S.len - S.step; // 长度递减
    var idx = S.step === 0 ? 0 : (S.len - S.step);
    // 忠实: y初值=len(5或3), 每列递减? 原版按 AreaObjectLength 递减
    // 简化: 用每列c = S.step(0-4), 从 CastleMetatiles 布局取列数据
    var c = S.step;
    // CastleMetatiles 为列优先存储(高城堡5x10+; 5列), 每列数据在 [c], [c+5], [c+10]...
    // 原版 CRendLoop: 从 startRow 开始, 沿 y 每 +5 取下一个, 直到 row 11
    var startRow = S.startRow === 0 ? 1 : 5; // 造型0=高(从行1), 其他=行5起
    var yy = startRow;
    var k = c;
    while (yy <= 10) {
      L.set(col, yy, CM[k]);
      yy++; k += 5;
    }
    // 第二列后放地面砖块停住玩家(在行10)
    if (S.step >= 1 && (S.len - S.step) <= 1) L.set(col, 10, 0x52);
    // 上升旗: 第3列注册
    if (S.step === 2 && L.starflagX < 0) {
      L.starflagX = absObjCol * 16 + 32;
    }
    S.step++;
  } else finish();
}

// 出口管(3列宽侧向管)
function runExitPipe(L, a, col, absObjCol, nyb, finish) {
  var S = a.state;
  if (S.step === undefined) { S.step = 0; S.len = 3; }
  if (col < absObjCol) return;
  if (S.step < S.len) {
    var sp = TB.SidePipeTopPart, sb = TB.SidePipeBottomPart;
    var shaft = TB.SidePipeShaftData;
    var i = S.step;
    if (shaft[i] !== 0) {
      L.renderUnder(col, 0, shaft[i], nyb - 1);
    }
    L.set(col, nyb, sp[i]);
    L.set(col, nyb + 1, sb[i]);
    S.step++;
  } else finish();
}

// ---------- 敌人流解码 ----------
function decodeEnemyData(L, data, worldNumber, DS) {
  var page = 0, pageSel = false;
  var p = 0;
  var hardMode = false; // 二周目标志, 由游戏状态传入; 默认关
  while (p < data.length) {
    var b1 = data[p];
    if (b1 === 0xff) break;
    var b2 = data[p + 1];
    var row = b1 & 0x0f, col = (b1 >> 4) & 0x0f;
    // 页递增对所有对象类型(含 row E 三字节对象)先判断
    if ((b2 & 0x80) && !pageSel) { page++; pageSel = true; }
    if (row === 0x0e) {
      // 三字节: 换区入口
      var b3 = data[p + 2];
      L.warps.push({
        x: col * 16, y: row * 16, col: col,
        destArea: b2 & 0x7f, destPage: b3 & 0x1f, worldCond: (b3 >> 5) & 7
      });
      p += 3; pageSel = false; continue;
    }
    if (row === 0x0f) {
      page = b2 & 0x3f; pageSel = true;
      p += 2; continue;
    }
    var id = b2 & 0x3f;
    var isHard = (b2 & 0x40) !== 0;
    pageSel = false;
    if (!isHard || hardMode) {
      var x = page * 256 + col * 16;
      var y = row * 16;
      if (id >= 0x37 && id <= 0x3f) {
        // 组合敌人: bit0=3只, 否则2只; $3b+=Koopa; Y用对象行
        var count = (id & 1) ? 3 : 2;
        var isKoopa = id >= 0x3b;
        for (var g = 0; g < count; g++) {
          L.enemies.push({
            x: x + g * 16, y: y,
            id: (isKoopa && hardMode) ? 0x02 : (isKoopa ? 0x00 : (hardMode ? 0x02 : 0x06))
          });
        }
      } else {
        L.enemies.push({ x: x, y: y, id: id });
      }
    }
    p += 2;
  }
  L.enemies.sort(function (a, b) { return a.x - b.x; });
}

// 供渲染/调试: 解码当前游戏的关卡
function decodeCurrentLevel(world, area) {
  return decodeLevel(world, area, 0);
}
