// datasets.js — 版本数据集抽象: 每个版本提供 数据/分派表/元瓦片艺术/内容/物理
// SMB1 = 初代(1985)  SMB2J = 失落的关卡(1986)

// ---------- SMB1 分派表(case → 处理器名, 来自 smbdis.asm) ----------
var SMB1_DISPATCH = [
  "VerticalPipe", "AreaStyleObject", "RowOfBricks", "RowOfSolidBlocks", "RowOfCoins",
  "ColumnOfBricks", "ColumnOfSolidBlocks", "VerticalPipe",
  "Hole_Empty", "PulleyRopeObject", "Bridge_High", "Bridge_Middle", "Bridge_Low",
  "Hole_Water", "QuestionBlockRow_High", "QuestionBlockRow_Low",
  "EndlessRope", "BalancePlatRope", "CastleObject", "StaircaseObject", "ExitPipe",
  "FlagBalls_Residual",
  "QuestionBlock", "QuestionBlock", "QuestionBlock", "Hidden1UpBlock",
  "BrickWithItem", "BrickWithItem", "BrickWithItem", "BrickWithCoins", "BrickWithItem",
  "WaterPipe", "EmptyBlock", "Jumpspring",
  "IntroPipe", "FlagpoleObject", "AxeObj", "ChainObj",
  "CastleBridgeObj", "ScrollLockObject_Warp", "ScrollLockObject", "ScrollLockObject",
  "AreaFrenzy", "AreaFrenzy", "AreaFrenzy", "LoopCmdE", "AlterAreaAttributes",
];

// ---------- SMB2J 元瓦片 → 图集映射 ----------
// 编码含义来自 smb2j 反汇编 Palette0-3_MTiles 注释(与 SMB1 不同: 插入毒蘑菇条目)
var SMB2J_ART = {};
(function () {
  var A = SMB2J_ART;
  // 调色板0 与 SMB1 完全一致 (0x00-0x26)
  for (var k in MT_ART) {
    var code = +k;
    if (code <= 0x26) A[code] = MT_ART[k];
  }
  // 调色板1: 0x40-0x4e 与 SMB1 相同; 0x4f 起重排
  var same = [0x40, 0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x4b, 0x4c, 0x4d, 0x4e];
  for (var i = 0; i < same.length; i++) A[same[i]] = MT_ART[same[i]];
  A[0x4f] = MT_ART[0x51];  // 带线砖(地面)
  A[0x50] = MT_ART[0x52];  // 砖
  A[0x51] = MT_ART[0x51];  // 未用
  A[0x52] = MT_ART[0x51]; A[0x53] = MT_ART[0x51]; A[0x54] = MT_ART[0x51];
  A[0x55] = MT_ART[0x51]; A[0x56] = MT_ART[0x51]; A[0x57] = MT_ART[0x51]; // 带线砖(含物)
  A[0x58] = MT_ART[0x52]; A[0x59] = MT_ART[0x52]; A[0x5a] = MT_ART[0x52];
  A[0x5b] = MT_ART[0x52]; A[0x5c] = MT_ART[0x52]; A[0x5d] = MT_ART[0x52]; // 砖(含物)
  A[0x5e] = [-1, -1]; A[0x5f] = [-1, -1]; A[0x60] = [-1, -1]; A[0x61] = [-1, -1]; // 隐藏块(不可见)
  A[0x62] = MT_ART[0x61];  // 实心3D块
  A[0x63] = MT_ART[0x62];  // 白墙
  A[0x64] = MT_ART[0x63];  // 桥板
  A[0x65] = MT_ART[0x64]; A[0x66] = MT_ART[0x65]; A[0x67] = MT_ART[0x66]; // 炮台
  A[0x68] = [-1, -1];      // 弹簧占位
  // SMB2J 后段重排: 0x69半砖簧 0x6a=地面(裂纹岩!) 0x6b半砖 0x6c/6d水管 0x6e旗球
  A[0x69] = MT_ART[0x68];
  A[0x6a] = MT_ART[0x54];  // ★地面块(裂纹岩) — SMB2J 地形编码
  A[0x6b] = MT_ART[0x68];
  A[0x6c] = MT_ART[0x6b]; A[0x6d] = MT_ART[0x6c]; // 水管(水关)
  A[0x6e] = MT_ART[0x6d];  // 旗球
  // 调色板2: 0x80-0x89 同 SMB1; 0x8a-8c 云台
  for (var c2 = 0x80; c2 <= 0x89; c2++) A[c2] = MT_ART[c2];
  A[0x8a] = MT_ART[0x19]; A[0x8b] = MT_ART[0x1a]; A[0x8c] = MT_ART[0x1b]; // 云台(借蘑菇台图)
  // 调色板3: ?块/金币/用块/斧头(顺序不同)
  A[0xc0] = MT_ART[0xc0]; A[0xc1] = MT_ART[0xc0]; A[0xc2] = MT_ART[0xc0]; // ?块(币/道具/毒)
  A[0xc3] = MT_ART[0xc2]; A[0xc4] = MT_ART[0xc3]; // 金币/水金币
  A[0xc5] = MT_ART[0xc4]; // 用过的块
  A[0xc6] = MT_ART[0xc5]; // 斧头
})();

// ---------- 元瓦片 → 内容 ----------
var SMB1_CONTENT = {
  0xc0: "coin", 0xc1: "mushroom", 0x5f: "coin:hidden", 0x60: "1up:hidden",
  0x55: "mushroom", 0x56: "vine", 0x57: "star", 0x58: "multicoin", 0x59: "1up",
  0x5a: "mushroom", 0x5b: "vine", 0x5c: "star", 0x5d: "multicoin", 0x5e: "1up",
};
var SMB2J_CONTENT = {
  // ?块
  0xc0: "coin", 0xc1: "mushroom", 0xc2: "poison",
  // 带线砖
  0x52: "mushroom", 0x53: "poison", 0x54: "vine", 0x55: "star", 0x56: "multicoin", 0x57: "1up",
  // 砖
  0x58: "mushroom", 0x59: "poison", 0x5a: "vine", 0x5b: "star", 0x5c: "multicoin", 0x5d: "1up",
  // 隐藏块
  0x5e: "coin:hidden", 0x5f: "1up:hidden", 0x60: "poison:hidden", 0x61: "mushroom:hidden",
};

// ---------- 实心判定(SMB2J: 调色板1下界=0x4f, 其余同) ----------
function solidBoundsFor(ds) {
  return ds.solidBounds || [0x10, 0x51, 0x88, 0xc0];
}

// ---------- 物理表 ----------
// SMB2J JumpFrictionData: 马里奥段 / 路易吉段(高跳+低摩擦)
var SMB2J_PHYS = {
  mario:  { rise: [0x20, 0x20, 0x1e, 0x28, 0x28], fall: [0x70, 0x70, 0x60, 0x90, 0x90], fric: [0xe4, 0x98, 0xd0] },
  luigi:  { rise: [0x18, 0x18, 0x18, 0x22, 0x22], fall: [0x42, 0x42, 0x3e, 0x5d, 0x5d], fric: [0xb4, 0x68, 0xa0] },
};

// ---------- 数据集 ----------
var DATASETS = {
  smb1: {
    id: "smb1", name: "SUPER MARIO BROS.",
    LEVEL_DATA: (typeof LEVEL_DATA !== "undefined") ? LEVEL_DATA : {},
    dispatch: SMB1_DISPATCH,
    tables: (typeof SMB_TABLES !== "undefined") ? SMB_TABLES : {},
    worldTables: (typeof LEVEL_TABLES !== "undefined") ? LEVEL_TABLES : {},
    // 指针表形态: 低/高字节分开(SMB1)
    ptrStyle: "lohi",
    art: MT_ART,
    content: SMB1_CONTENT,
    features: { luigi: false, wind: false, poison: false },
    phys: null,
    worldCount: 8,
  },
  smb2j: (function () {
    var D = SMB2J_DATA;
    var worldTables = {};
    for (var k in D) {
      if (k !== "LEVEL_DATA" && k !== "DISPATCH" && k !== "EnemyPtrsMain" && k !== "AreaPtrsMain" &&
          k !== "EnemyPtrsAD" && k !== "AreaPtrsAD") worldTables[k] = D[k];
    }
    worldTables.EnemyDataAddrLow = D.EnemyPtrsMain.map(function (v) { return v & 0xff; });
    worldTables.EnemyDataAddrHigh = D.EnemyPtrsMain.map(function (v) { return v >> 8; });
    worldTables.AreaDataAddrLow = D.AreaPtrsMain.map(function (v) { return v & 0xff; });
    worldTables.AreaDataAddrHigh = D.AreaPtrsMain.map(function (v) { return v >> 8; });
    worldTables.ADEnemyDataAddrLow = D.EnemyPtrsAD.map(function (v) { return v & 0xff; });
    worldTables.ADEnemyDataAddrHigh = D.EnemyPtrsAD.map(function (v) { return v >> 8; });
    worldTables.ADAreaDataAddrLow = D.AreaPtrsAD.map(function (v) { return v & 0xff; });
    worldTables.ADAreaDataAddrHigh = D.AreaPtrsAD.map(function (v) { return v >> 8; });
    var byPtr = {};
    for (var name in D.LEVEL_DATA) byPtr[D.LEVEL_DATA[name].ptr] = name;
    return {
      id: "smb2j", name: "THE LOST LEVELS",
      LEVEL_DATA: D.LEVEL_DATA,
      BY_PTR: byPtr,
      dispatch: D.DISPATCH,
      tables: worldTables,
      worldTables: worldTables,
      ptrStyle: "lohi", // 已拆成低/高表
      art: SMB2J_ART,
      content: SMB2J_CONTENT,
      features: { luigi: true, wind: true, poison: true },
      phys: SMB2J_PHYS,
      worldCount: 13, // 1-8 + 世界9(8) + A-D(9-12)
    };
  })(),
};
