// sprites.js — player.png / enemy.png 精灵表坐标映射
// player.png: 416x528, 16px列 x 32px行对
//   行对0: 小马里奥(右), 1: 大马里奥(右), 2: 火马里奥(右)
//   行对3: 小(左), 4: 大(左), 5: 火(左)
//   列: 2=站 3-5=走 6=急停 7=跳 8-10=游泳 11-12=爬藤 13=死亡
var SHEET = {
  player: { src: "assets/sprites/player.png" },
  enemy: { src: "assets/sprites/enemy.png" },
  tiles: { src: "assets/sprites/tiles.png" },
  title: { src: "assets/sprites/title.png" },
};

// size: 0=小 1=大 2=火; dir: 0=右 1=左
// pose: idle, walk1..3, skid, jump, swim1..3, climb1..2, death, crouch
function marioFrame(size, dir, pose) {
  var rowPair = size + (dir ? 3 : 0);
  var col;
  switch (pose) {
    case 'idle': col = 2; break;
    case 'walk1': col = 3; break;
    case 'walk2': col = 4; break;
    case 'walk3': col = 5; break;
    case 'skid': col = 6; break;
    case 'jump': col = 7; break;
    case 'swim1': col = 8; break;
    case 'swim2': col = 9; break;
    case 'swim3': col = 10; break;
    case 'climb1': col = 11; break;
    case 'climb2': col = 12; break;
    case 'death': col = 13; break;
    case 'crouch': col = size === 0 ? 2 : 10; break; // 小马里奥无蹲
    case 'crouchwalk': col = size === 0 ? 3 : 11; break;
    default: col = 2;
  }
  var h = size === 0 ? 16 : 32;
  // 小马里奥在槽内底部对齐: 小马里奥内容位于其32px槽的下16px
  return { sx: col * 16, sy: rowPair * 32 + (size === 0 ? 16 : 0), sw: 16, sh: h };
}

// ---- enemy.png: 顶部两行带(y0-63)为主, 每格16宽 ----
// 结构(连接域分析结果): 成对/成组排列, 见注释
var ENEMY_FRAMES = {
  // goomba: x0-31 y16-31 两帧并排
  goomba1:   { sx: 0,   sy: 16, sw: 16, sh: 16 },
  goomba2:   { sx: 16,  sy: 16, sw: 16, sh: 16 },
  goombaFlat:{ sx: 32,  sy: 24, sw: 16, sh: 8 },
  goombaG1:  { sx: 48,  sy: 16, sw: 16, sh: 16 }, // 灰色(地下/城堡)
  goombaG2:  { sx: 64,  sy: 16, sw: 16, sh: 16 },
  goombaGFlat:{ sx: 80, sy: 24, sw: 16, sh: 8 },
  // koopa 绿: 帧1 x96 y8-31(16x24), 帧2 x112
  koopa1:    { sx: 96,  sy: 8, sw: 16, sh: 24 },
  koopa2:    { sx: 112, sy: 9, sw: 16, sh: 23 },
  // koopa 红: x128-159 两帧
  koopaR1:   { sx: 128, sy: 8, sw: 16, sh: 24 },
  koopaR2:   { sx: 144, sy: 8, sw: 16, sh: 24 },
  // x160-223 (64宽=4个): 壳与出壳动画/甲虫
  shell:     { sx: 160, sy: 8, sw: 16, sh: 16 },  // 绿壳(16x16 取底部)
  shellG:    { sx: 176, sy: 8, sw: 16, sh: 16 },  // 灰壳/蓝壳?
  shellSpin1:{ sx: 192, sy: 8, sw: 16, sh: 16 },
  shellSpin2:{ sx: 208, sy: 8, sw: 16, sh: 16 },
  // x224-287 (4个): 甲虫(BuzzyBeetle)2帧 + 锤子兄?
  buzzy1:    { sx: 224, sy: 8, sw: 16, sh: 24 },
  buzzy2:    { sx: 240, sy: 8, sw: 16, sh: 24 },
  shellBuzzy:{ sx: 256, sy: 8, sw: 16, sh: 16 },
  koopaWake: { sx: 272, sy: 8, sw: 16, sh: 24 },  // 出壳帧(待校准)
  // x288-319: 锤子兄(2帧)+锤子
  hammerBro1:{ sx: 288, sy: 8, sw: 16, sh: 23 },
  hammerBro2:{ sx: 304, sy: 8, sw: 16, sh: 23 },
  // 遗留: 上面 x288 处连接域是 32 宽 — 需要拆分校准; 先按单格用
  hammer:    { sx: 304, sy: 40, sw: 16, sh: 16 },
  // 炮弹
  bullet:    { sx: 320, sy: 8, sw: 16, sh: 24 },
  bulletTail:{ sx: 336, sy: 8, sw: 16, sh: 24 },
  // 鱼 cheep cheep: x353-367(小) x369-399(两帧)
  cheepSmall:{ sx: 353, sy: 8, sw: 15, sh: 24 },
  cheep1:    { sx: 369, sy: 8, sw: 15, sh: 24 },
  cheep2:    { sx: 385, sy: 8, sw: 15, sh: 24 },
  // 食人花: x416-447 (闭/开)
  piranhaC:  { sx: 416, sy: 8, sw: 16, sh: 24 },
  piranhaO:  { sx: 432, sy: 8, sw: 16, sh: 24 },
  // y80-95 段: 刺猬/Lakitu (x449..590)
  spiny1:    { sx: 449, sy: 80, sw: 14, sh: 16 },
  spiny2:    { sx: 465, sy: 80, sw: 14, sh: 16 },
  spinyBall: { sx: 480, sy: 80, sw: 16, sh: 16 },
  lakitu1:   { sx: 496, sy: 80, sw: 16, sh: 16 },
  lakitu2:   { sx: 512, sy: 80, sw: 16, sh: 16 },
  lakituShell:{ sx: 528, sy: 80, sw: 16, sh: 16 },
  spinyBall2:{ sx: 577, sy: 80, sw: 14, sh: 16 },
  // 乌贼 bloober: x560-575 y17-30 (16x14)? 待校准 — 暂用lakitu区附近
  bloober1:  { sx: 560, sy: 17, sw: 16, sh: 14 },
  bloober2:  { sx: 560, sy: 49, sw: 16, sh: 14 },
  // Bowser: x592-623 (32x24) 帧1, x624-654 (32x16) 帧2
  bowser1:   { sx: 592, sy: 8,  sw: 32, sh: 24 },
  bowser2:   { sx: 624, sy: 16, sw: 31, sh: 16 },
  // Bowser火焰: x640s? 炮台 32x32 x656+
  bowserFire1:{ sx: 656, sy: 0, sw: 16, sh: 16 },
  cannon1:   { sx: 688, sy: 0, sw: 32, sh: 32 },
  cannon2:   { sx: 720, sy: 0, sw: 32, sh: 32 },
  // 火球怪 podoboo x784-807 (24x16)? 用带2: y32-63
  podoboo1:  { sx: 784, sy: 0, sw: 24, sh: 16 },
  podoboo2:  { sx: 784, sy: 32, sw: 24, sh: 16 },
};

// player.png 底部附加精灵
// 火球4帧: 行26(y416-447) — 由渲染校准; 碎砖: 同行右侧
var MISC_FRAMES = {
  fireball1: { sheet: 'player', sx: 80,  sy: 424, sw: 16, sh: 16 },
  fireball2: { sheet: 'player', sx: 128, sy: 424, sw: 16, sh: 16 },
  fireball3: { sheet: 'player', sx: 176, sy: 424, sw: 16, sh: 16 },
  fireball4: { sheet: 'player', sx: 224, sy: 424, sw: 16, sh: 16 },
  brickBit1: { sheet: 'player', sx: 272, sy: 424, sw: 16, sh: 16 },
  brickBit2: { sheet: 'player', sx: 320, sy: 424, sw: 16, sh: 16 },
  brickBit3: { sheet: 'player', sx: 368, sy: 424, sw: 16, sh: 16 },
  brickBit4: { sheet: 'player', sx: 416-16, sy: 424, sw: 16, sh: 16 },
};

// 蘑菇/花/星/1UP 等 — enemy.png 中未含, 用 tiles.png 或程序绘制
// 蘑菇: tiles.png ? 待校准; 星星/花同
var ITEM_FRAMES = {
  mushroom: { sheet: 'tiles', sx: 0,  sy: 6, sw: 16, sh: 16 }, // 待校准
  flower:   { sheet: 'tiles', sx: 16, sy: 6, sw: 16, sh: 16 },
  star:     { sheet: 'tiles', sx: 32, sy: 6, sw: 16, sh: 16 },
  oneup:    { sheet: 'tiles', sx: 48, sy: 6, sw: 16, sh: 16 },
};
