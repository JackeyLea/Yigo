// game.js — 游戏主逻辑: 状态机/碰撞/方块/HUD/流程
var SCREEN_W = 256, SCREEN_H = 240;
var ST = { VERSION_SELECT: 11, TITLE: 0, INTRO: 1, PLAYING: 2, DYING: 3, FLAG: 4, CASTLE_WALK: 5, TIMECOUNT: 6, LEVEL_END: 7, GAMEOVER: 8, PIPE: 9, WIN: 10 };

function Game(canvas) {
  this.canvas = canvas;
  this.ctx = canvas.getContext("2d");
  this.ctx.imageSmoothingEnabled = false;
  this.images = {};
  this.input = { left: false, right: false, up: false, down: false, jump: false, run: false, start: false };
  this.prevInput = {};
  this.state = ST.VERSION_SELECT;
  this.frame = 0;
  this.menuSel = 0;         // 标题菜单 0=1P
  this.world = 0; this.area = 0;
  this.score = 0; this.topScore = 0; this.coins = 0; this.lives = 3;
  this.time = 400; this.timeFrames = 0;
  this.timeWarned = false;
  this.stats = {};
  this.enemies = [];
  this.items = [];
  this.fireballs = [];
  this.particles = [];
  this.blockAnim = {};       // col,row -> {timer, oldMt}
  this.scrollX = 0;
  this.scrollLock = false;
  this.spawnIdx = 0;
  this.stompChain = 0;
  this.stompTimer = 0;
  this.enemyIdSeq = 0;
  this.flagSeq = 0;
  this.level = null;
  this.mainAreaState = null; // 主关卡备份(奖励区返回)
  this.introTimer = 0;
  this.deathTimer = 0;
  this.pipeAnim = null;
  this.checkpoint = null;    // 中途点
  this.hidden1upFlag = false;
  this.debug = {};
  this.player = new Player(this);
  this.frameSkip = 0;
  this.version = "smb1";
  this.ds = DATASETS.smb1;
  this.character = 0;   // 0=马里奥 1=路易吉(SMB2J)
  this.menuIdx = 0;     // 版本选择光标
  this.windPhase = 0;
  this.speedRun = false;
  this.brickCoinTimers = {}; // 多金币砖
  this.piranhaIdx = 0;
  this.pendingLevelFade = 0;
}

Game.prototype.loadImages = function (cb) {
  var self = this;
  var names = ["player", "enemy", "tiles", "title"];
  var done = 0;
  names.forEach(function (n) {
    var img = new Image();
    img.onload = function () { self.images[n] = img; if (++done === names.length) cb(); };
    img.onerror = function () { console.error("img fail", n); if (++done === names.length) cb(); };
    img.src = SHEET[n].src;
  });
};

// ============ 关卡装载 ============
Game.prototype.startGame = function () {
  this.ds = DATASETS[this.version] || DATASETS.smb1;
  this.world = 0; this.area = 0;
  this.score = 0; this.coins = 0; this.lives = 3;
  this.state = ST.INTRO;
  this.introTimer = 0;
  this.checkpoint = null;
  this.mainAreaState = null;
  this.player.reset();
  this.applyPhysics();
};

// 按版本/角色装载物理(SMB2J 路易吉: 高跳+滑)
Game.prototype.applyPhysics = function () {
  var P = this.player;
  if (this.ds.phys && this.ds.features.luigi) {
    var ph = this.character === 1 ? this.ds.phys.luigi : this.ds.phys.mario;
    P.riseTable = ph.rise; P.fallTable = ph.fall; P.fricTable = ph.fric;
  } else {
    P.riseTable = [0x20, 0x20, 0x1e, 0x28, 0x28];
    P.fallTable = [0x70, 0x70, 0x60, 0x90, 0x90];
    P.fricTable = [0xe4, 0x98, 0xd0];
  }
};

Game.prototype.loadArea = function (world, area, entry) {
  entry = entry || {};
  var L = decodeLevel(world, area, this.time, this.ds);
  this._finishLoadArea(L, entry);
};
// 直接按区域指针字节加载(奖励区/传送区)
Game.prototype.loadAreaByPointer = function (ptr, entry) {
  entry = entry || {};
  var L = decodeLevelByPointer(ptr, this.world, this.ds);
  this._finishLoadArea(L, entry);
};
Game.prototype._finishLoadArea = function (L, entry) {
  this.level = L;
  this.enemies = [];
  this.items = [];
  this.fireballs = [];
  this.particles = [];
  this.blockAnim = {};
  this.brickCoinTimers = {};
  // 敌人合并 piranhas
  this.spawnList = L.enemies.slice();
  // 时间(奖励区保留时间)
  if (!entry.keepTime) {
    var tset = L.timerSetting;
    if (tset > 0) this.time = [400, 400, 300, 200][tset];
  }
  this.timeWarned = false;
  // 起点
  var startX = entry.px !== undefined ? entry.px : (L.startType === 3 ? 40 : 40);
  var startY = entry.py !== undefined ? entry.py : 0;
  if (entry.startType === 1 || L.startType === 1) startY = 0;   // 竖直下落
  this.player.reset();
  this.player.x = startX;
  this.player.py = startY;
  if (L.startType === 1) { this.player.py = 40; this.player.state = 2; }
  if (entry.px === undefined && L.startType !== 1) this.snapPlayerToGround();
  this.scrollX = entry.scrollX !== undefined ? entry.scrollX : Math.max(0, this.player.x - 80);
  this.scrollLock = false;
  this.state = ST.PLAYING;
  this.stats = { jumpCount: 0 };
  this.spawnIdx = 0;
  this.piranhaIdx = 0;
  // 食人花并入生成列表
  for (var i = 0; i < (L.piranhas || []).length; i++) {
    this.spawnList.push({ x: L.piranhas[i].x, y: L.piranhas[i].y, id: 0x0d });
  }
  // 弹簧
  for (var i = 0; i < (L.springs || []).length; i++) {
    var sp = L.springs[i];
    this.spawnList.push({ x: sp.x, y: sp.y, id: 0x32 });
  }
  this.spawnList.sort(function (a, b) { return a.x - b.x; });
  this.currentWarp = null;
  this.warpIdx = 0;
  this.playAreaMusic();
};

Game.prototype.snapPlayerToGround = function () {
  var p = this.player;
  for (var row = 0; row < LEVEL_ROWS; row++) {
    if (this.solidAtCol(Math.floor((p.x + 6) / 16), row)) {
      p.py = row * 16 - p.height();
      p.onGround = true;
      return;
    }
  }
  p.py = 176;
};

Game.prototype.solidAtCol = function (col, row) {
  if (row < 0 || row >= LEVEL_ROWS) return false;
  var mt = this.level.at(col, row);
  return isSolidMetatile(mt) && mt !== 0x5f && mt !== 0x60;
};

Game.prototype.playAreaMusic = function () {
  var L = this.level;
  var name;
  if (this.player && this.player.starTimer > 0) return;
  if (L.areaType === 0) name = this.timeWarned ? "music_underwater_fast" : "music_underwater";
  else if (L.style === 1) name = this.timeWarned ? "music_underground_fast" : "music_underground";
  else if (L.style === 2) name = this.timeWarned ? "music_castle_fast" : "music_castle";
  else name = this.timeWarned ? "music_overworld_fast" : "music_overworld";
  AudioSys.playMusic(name);
};

Game.prototype.onStarEnd = function () {
  this.playAreaMusic();
};

// ============ 碰撞辅助 ============
// 玩家 hitbox: x+2 .. x+w (w=12), py .. py+h
Game.prototype.tileAt = function (px, py) {
  var col = Math.floor(px / 16), row = Math.floor(py / 16);
  return this.level.at(col, row);
};

Game.prototype.collideWall = function (p, dir) {
  var top = p.py + 2, bot = p.py + p.height() - 2;
  var x = dir > 0 ? p.x + 2 + p.width() : p.x + 2;
  for (var y = top; y <= bot; y += 8) {
    var mt = this.tileAt(x, y + 32 - 32);
    // tileAt使用playfield坐标: y直接
    if (this.solidAt(Math.floor(x / 16), Math.floor(y / 16))) return true;
  }
  return this.solidAt(Math.floor(x / 16), Math.floor(bot / 16));
};

Game.prototype.solidAt = function (col, row) {
  if (row < 0) return false;
  if (row >= LEVEL_ROWS) return false;
  var mt = this.level.at(col, row);
  if (mt === 0x5f || mt === 0x60) return false; // 隐藏块
  return isSolidMetatile(mt);
};

Game.prototype.collideFloor = function (p) {
  var feet = p.py + p.height();
  var row = Math.floor(feet / 16);
  var xs = [p.x + 3, p.x + p.width() - 3];
  for (var i = 0; i < xs.length; i++) {
    if (this.solidAt(Math.floor(xs[i] / 16), row)) {
      // 只在脚进入该行时着地
      if (feet > row * 16 && feet <= row * 16 + 8 + p.ys) return true;
    }
  }
  return false;
};

Game.prototype.collideCeil = function (p) {
  var head = p.py;
  var row = Math.floor(head / 16);
  var xs = [p.x + 3, p.x + p.width() - 3];
  for (var i = 0; i < xs.length; i++) {
    if (this.solidAt(Math.floor(xs[i] / 16), row)) return true;
  }
  return false;
};

Game.prototype.inWater = function (p) {
  var mt = this.tileAt(p.x + 6, p.py + p.height() / 2);
  return mt === 0x86 || mt === 0x87;
};

Game.prototype.enemyWall = function (e, dir) {
  var x = dir > 0 ? e.x + e.w : e.x;
  var my = e.py + e.h - 2;
  return this.solidAt(Math.floor(x / 16), Math.floor(my / 16));
};
Game.prototype.enemyFloor = function (e) {
  var feet = e.py + e.h;
  var row = Math.floor(feet / 16);
  var xs = [e.x + 1, e.x + e.w - 1];
  for (var i = 0; i < 2; i++) {
    if (this.solidAt(Math.floor(xs[i] / 16), row)) return true;
  }
  return false;
};
Game.prototype.enemyLedge = function (e) {
  var feet = e.py + e.h;
  var row = Math.floor((feet + 1) / 16);
  var ahead = e.xs > 0 ? e.x + e.w + 1 : e.x - 1;
  return this.solidAt(Math.floor(ahead / 16), row);
};
Game.prototype.itemFloor = function (it, halfH) {
  var h = halfH || 16;
  var feet = it.py + h;
  var row = Math.floor(feet / 16);
  var xs = [it.x + 2, it.x + 14 - 2];
  for (var i = 0; i < 2; i++) {
    if (this.solidAt(Math.floor(xs[i] / 16), row)) return true;
  }
  return false;
};
Game.prototype.itemWall = function (it, dir) {
  var x = dir > 0 ? it.x + 15 : it.x;
  return this.solidAt(Math.floor(x / 16), Math.floor((it.py + 8) / 16));
};
Game.prototype.fireballWall = function (f) {
  var x = f.x + Math.sign(f.xs) * 4;
  return this.solidAt(Math.floor(x / 16), Math.floor((f.py + 4) / 16));
};

Game.prototype.enemyEnemyCollide = function (e) {
  for (var i = 0; i < this.enemies.length; i++) {
    var o = this.enemies[i];
    if (o === e || o.removed || !o.alive) continue;
    if (o.noCollide || e.noCollide) continue;
    if (Math.abs(o.x - e.x) < 14 && Math.abs(o.py - e.py) < 14) {
      if ((e.x < o.x && e.xs > 0) || (e.x > o.x && e.xs < 0)) {
        if (e.state === 5) { o.kill(e.xs); this.addScore(100, o.x, o.py); continue; }
        if (o.state === 5) { e.kill(o.xs); continue; }
        e.xs = -e.xs; o.xs = -o.xs;
      }
    }
  }
};

// ============ 方块交互 ============
Game.prototype.bonkBlock = function (p) {
  // 找头顶正上方块(取玩家中心)
  var cx = p.x + 6;
  var row = Math.floor((p.py - 1) / 16);
  // 检查中心与两侧
  var cols = [Math.floor(cx / 16)];
  var l = Math.floor((p.x + 2) / 16), r = Math.floor((p.x + 10) / 16);
  if (l !== cols[0]) cols.unshift(l);
  if (r !== cols[cols.length - 1]) cols.push(r);
  // 优先最接近中心的
  var bestCol = cols[0];
  var bestDist = 99;
  for (var i = 0; i < cols.length; i++) {
    var cdist = Math.abs(cols[i] * 16 + 8 - cx);
    if (cdist < bestDist && this.solidAt(cols[i], row)) { bestDist = cdist; bestCol = cols[i]; }
  }
  var col = bestCol;
  var mt = this.level.at(col, row);
  var hiddenSet = this.ds.id === "smb2j" ? [0x5e, 0x5f, 0x60, 0x61] : [0x5f, 0x60];
  if (!mt || !isSolidMetatile(mt)) {
    for (var i = 0; i < cols.length; i++) {
      var hmt = this.level.at(cols[i], row);
      if (hiddenSet.indexOf(hmt) >= 0) { col = cols[i]; mt = hmt; break; }
    }
  }
  if (!mt) return;
  var L = this.level;
  var usedCode = this.ds.id === "smb2j" ? 0xc5 : 0xc4;

  // 数据集内容映射: 元瓦片 → 内容描述
  var content = this.ds.content[mt];
  var isBrickLike = (mt === 0x51 || mt === 0x52 ||   // SMB1 砖
    (this.ds.id === "smb2j" && (mt === 0x4f || mt === 0x50)));  // SMB2J 砖
  if (!content && isBrickLike) content = "plainbrick";
  if (!content && (mt === 0xc0 || mt === 0xc1 || (this.ds.id === "smb2j" && mt === 0xc2))) {
    // ?块无内容记录时兜底(不应发生)
    content = (mt === 0xc1) ? "mushroom" : "coin";
  }

  var kind = content ? content.split(":")[0] : null;
  var hidden = content ? content.indexOf(":hidden") >= 0 : false;

  switch (kind) {
    case "coin":
      this.bumpBlock(col, row, mt);
      this.spawnCoinPop(col, row);
      this.addCoin();
      this.level.set(col, row, usedCode);
      break;
    case "mushroom":
      this.bumpBlock(col, row, mt);
      this.spawnBlockItem(col, row, p.status === 0 ? "mushroom" : "flower");
      this.level.set(col, row, usedCode);
      break;
    case "poison":
      this.bumpBlock(col, row, mt);
      this.spawnBlockItem(col, row, "poison");
      this.level.set(col, row, usedCode);
      break;
    case "1up":
      this.bumpBlock(col, row, mt);
      this.spawnBlockItem(col, row, "oneup");
      this.level.set(col, row, usedCode);
      break;
    case "vine":
      this.bumpBlock(col, row, mt);
      this.spawnVine(col, row);
      this.level.set(col, row, usedCode);
      break;
    case "star":
      this.bumpBlock(col, row, mt);
      this.spawnBlockItem(col, row, "star");
      this.level.set(col, row, usedCode);
      break;
    case "multicoin": {
      var key = col + "," + row;
      if (!this.brickCoinTimers[key]) this.brickCoinTimers[key] = { count: 10, timer: 231 };
      var bc = this.brickCoinTimers[key];
      this.spawnCoinPop(col, row);
      this.addCoin();
      this.bumpBlock(col, row, mt);
      bc.count--;
      if (bc.count <= 0) this.level.set(col, row, usedCode);
      break;
    }
    case "plainbrick":
    default:
      if (!content && isBrickLike && p.status > 0 && !hidden) {
        this.breakBrick(col, row);
      } else if (content) {
        // 带内容但未知类型: 按普通处理
        this.bumpBlock(col, row, mt);
        AudioSys.playSfx("sfx_bump");
      } else if (isBrickLike) {
        this.bumpBlock(col, row, mt);
        AudioSys.playSfx("sfx_bump");
      } else {
        this.bumpBlock(col, row, mt);
        AudioSys.playSfx("sfx_bump");
      }
      break;
  }
  // 顶块杀上方敌人
  this.killEnemiesAbove(col, row);
};

Game.prototype.bumpBlock = function (col, row, mt) {
  this.blockAnim[col + "," + row] = { timer: 16, mt: mt };
  if (mt === 0x51 || mt === 0x52) AudioSys.playSfx("sfx_bump");
  else AudioSys.playSfx("sfx_itemappear");
};

Game.prototype.breakBrick = function (col, row) {
  this.level.set(col, row, 0);
  this.addScore(50, col * 16, row * 16);
  AudioSys.playSfx("sfx_break");
  var px = col * 16, py = row * 16;
  this.particles.push(new Particle(this, "brickBit", px + 2, py, -1, -6));
  this.particles.push(new Particle(this, "brickBit", px + 10, py, 1, -6));
  this.particles.push(new Particle(this, "brickBit", px + 2, py + 8, -1, -3.5));
  this.particles.push(new Particle(this, "brickBit", px + 10, py + 8, 1, -3.5));
};

Game.prototype.spawnCoinPop = function (col, row) {
  var pt = new Particle(this, "coin", col * 16, row * 16 - 16);
  pt.ys = -5;
  this.particles.push(pt);
  AudioSys.playSfx("sfx_coin");
};

Game.prototype.spawnBlockItem = function (col, row, kind) {
  var it = new Item(this, kind, col * 16, row * 16);
  it.rise = 16;
  this.items.push(it);
  AudioSys.playSfx("sfx_itemappear");
};

Game.prototype.spawnVine = function (col, row) {
  AudioSys.playSfx("sfx_itemappear");
  var v = new Enemy(this, 0x2f, col * 16 + 4, row * 16 - 16);
  v.vineTop = row * 16 - 16 * 10;
  this.enemies.push(v);
};

Game.prototype.killEnemiesAbove = function (col, row) {
  var bx = col * 16, by = row * 16;
  for (var i = 0; i < this.enemies.length; i++) {
    var e = this.enemies[i];
    if (e.removed || !e.alive || e.noCollide) continue;
    if (e.x + e.w > bx && e.x < bx + 16 && Math.abs((e.py + e.h) - by) < 8) {
      if (e.kill(1)) this.addScore(100, e.x, e.py);
      AudioSys.playSfx("sfx_kick");
    }
  }
  // 顶到金币(砖上方)
  var above = this.level.at(col, row - 1);
  if (above === 0xc2 || above === 0xc3) {
    this.level.set(col, row - 1, 0);
    this.addCoin();
    this.spawnCoinPop(col, row - 1);
  }
};

Game.prototype.addCoin = function () {
  this.coins++;
  this.addScore(200);
  if (this.coins >= 100) { this.coins -= 100; this.gainLife(); }
};

Game.prototype.gainLife = function (x, y) {
  this.lives++;
  AudioSys.playSfx("sfx_1up");
  var pt = new Particle(this, "score", x || 40, (y || 40));
  pt.text = "1UP";
  this.particles.push(pt);
};

Game.prototype.addScore = function (pts, x, y) {
  this.score += pts;
  if (this.score > this.topScore) this.topScore = this.score;
  if (x !== undefined) {
    var pt = new Particle(this, "score", x, y);
    pt.text = pts >= 1000 && pts % 1000 === 0 ? String(pts) : String(pts);
    this.particles.push(pt);
  }
};

// ============ 敌人生成 ============
Game.prototype.updateSpawns = function () {
  var right = this.scrollX + SCREEN_W + 48;
  // 激活滚动经过的 warp 标记(原版 ParseRow0e 语义)
  var wl = this.level.warps || [];
  while (this.warpIdx < wl.length && wl[this.warpIdx].x <= right - 48) {
    var wp = wl[this.warpIdx++];
    if (wp.worldCond === this.world) {
      this.currentWarp = wp;
    }
  }
  while (this.spawnIdx < this.spawnList.length && this.spawnList[this.spawnIdx].x <= right) {
    var s = this.spawnList[this.spawnIdx++];
    if (s.x < this.scrollX - 32) continue; // 已经过的不再生成
    if (this.enemies.length > 8) break;
    this.spawnEnemy(s.id, s.x, s.y, s);
  }
};

Game.prototype.spawnEnemy = function (id, x, py, opts) {
  var e = new Enemy(this, id, x, py, opts);
  e.seed = this.enemyIdSeq++;
  this.enemies.push(e);
  return e;
};

Game.prototype.spawnHammer = function (x, py) {
  var h = new Particle(this, "hammer", x, py);
  h.xs = this.player.x < x ? -1 : 1;
  h.ys = -4;
  this.particles.push(h);
};

Game.prototype.spawnBowserFire = function (x, py) {
  var f = new Enemy(this, 0x15, x, py);
  this.enemies.push(f);
  AudioSys.playSfx("sfx_bullet");
};

Game.prototype.spawnFireball = function () {
  var p = this.player;
  var f = new Fireball(this, p.x + (p.dir > 0 ? 12 : -4), p.py + 8, p.dir);
  this.fireballs.push(f);
};

Game.prototype.spawnPoof = function (x, py) {
  this.particles.push(new Particle(this, "poof", x, py));
};

// ============ 玩家-敌人碰撞 ============
Game.prototype.playerEnemyCollide = function () {
  var p = this.player;
  if (p.dead || p.frozen > 0) return;
  var px1 = p.x + 2, px2 = p.x + 10;
  var py1 = p.py, py2 = p.py + p.height();
  var star = p.starTimer > 0;

  for (var i = 0; i < this.enemies.length; i++) {
    var e = this.enemies[i];
    if (e.removed || !e.alive) continue;
    var ex1 = e.x, ex2 = e.x + e.w;
    var ey1 = e.py, ey2 = e.py + e.h;
    if (px2 < ex1 || px1 > ex2 || py2 < ey1 || py1 > ey2) continue;
    // 重叠
    if (e.kind === "spring") continue;

    if (star) {
      if (e.kill(1)) {
        var sc = [100, 200, 400, 800, 1000, 2000, 4000, 5000, 8000][Math.min(this.starChain || 0, 8)];
        this.starChain = (this.starChain || 0) + 1;
        this.addScore(sc, e.x, e.py);
      }
      continue;
    }
    if (e.kind === "piranha" || e.kind === "podoboo" || e.kind === "firebarShort" || e.kind === "firebarMed" || e.kind === "firebarLong" || e.kind === "bowserFire" || e.kind === "bowser") {
      this.hurtPlayer();
      continue;
    }
    // 判断踩: 下落中且脚在敌人上部
    var stomping = p.ys > 0 && (py2 - ey1) < 10;
    if (stomping && e.kind !== "spiny" && e.kind !== "bloober") {
      var res = e.stomp(this.stompChain);
      if (res === "hurt") { this.hurtPlayer(); continue; }
      if (res === "kick") {
        // 踢壳
      } else {
        var chainPts = [100, 200, 400, 500, 800, 1000, 2000, 4000, 5000, 8000][Math.min(this.stompChain, 9)];
        if (this.stompChain >= 7) { this.gainLife(e.x, e.py); }
        else this.addScore(chainPts, e.x, e.py);
        this.stompChain++;
        this.stompTimer = 98;
      }
      p.ys = this.input.jump ? -4 : -3.5;
      p.yForce = 0;
      p.onGround = false;
      p.state = 1;
      p.jumpIdx = 0;
      AudioSys.playSfx("sfx_stomp");
    } else if (e.state === 4) {
      // 静止壳: 踢
      e.state = 5;
      e.timer = 0;
      e.slidingDir = (p.x + 6 < e.x + 8) ? 1 : -1;
      p.kickTimer = 8;
      AudioSys.playSfx("sfx_kick");
      this.addScore(400, e.x, e.py);
      // 立即离开壳
      if (e.slidingDir > 0 && p.x + 12 > e.x) p.x = e.x - 12;
      if (e.slidingDir < 0 && p.x < e.x + 16) p.x = e.x + 16;
    } else {
      this.hurtPlayer();
    }
  }
  // 壳滑时撞杀其他敌人已在 enemyEnemyCollide 处理
};

Game.prototype.hurtPlayer = function () {
  var p = this.player;
  if (p.injuryBlink > 0 || p.starTimer > 0 || p.dead) return;
  if (p.status > 0) {
    p.shrink();
  } else {
    this.killPlayer();
  }
};

Game.prototype.killPlayer = function () {
  var p = this.player;
  p.dead = true;
  p.deadTimer = 0;
  AudioSys.stopMusic();
  AudioSys.playMusic("jingle_death", { loop: false });
  this.state = ST.DYING;
};

Game.prototype.afterDeath = function () {
  this.lives--;
  if (this.lives <= 0) {
    this.state = ST.GAMEOVER;
    AudioSys.playMusic("jingle_gameover", { loop: false });
    this.gameOverTimer = 0;
  } else {
    // 中途点
    var useCheckpoint = this.checkpoint && this.area === (this.checkpoint.area || 0);
    this.state = ST.INTRO;
    this.introTimer = 0;
    if (useCheckpoint) {
      this.loadArea(this.world, this.area, {
        px: this.checkpoint.px,
        scrollX: this.checkpoint.scrollX,
      });
    }
  }
};

// ============ 物品拾取 ============
Game.prototype.playerItemCollide = function () {
  var p = this.player;
  if (p.dead) return;
  for (var i = 0; i < this.items.length; i++) {
    var it = this.items[i];
    if (it.removed || it.rise > 0) continue;
    if (p.x + 12 > it.x && p.x < it.x + 16 && p.py + p.height() > it.py && p.py < it.py + 16) {
      it.removed = true;
      switch (it.kind) {
        case "mushroom":
          this.addScore(1000, it.x, it.py);
          p.grow();
          break;
        case "flower":
          this.addScore(1000, it.x, it.py);
          if (p.status === 0) { p.grow(); p.pendingFire = true; }
          else p.grow();
          break;
        case "star":
          this.addScore(1000, it.x, it.py);
          p.starTimer = 735;
          this.starChain = 0;
          AudioSys.playMusic("music_star");
          break;
        case "oneup":
          this.gainLife(it.x, it.py);
          break;
        case "poison":
          if (p.status > 0) p.shrink();
          else this.killPlayer();
          break;
      }
    }
  }
};

// ============ 旗杆/过关 ============
Game.prototype.checkFlagpole = function () {
  var p = this.player;
  var L = this.level;
  if (!L.flagpole) return;
  var fx = L.flagpole.x; // 杆所在列左缘
  if (p.x + 12 >= fx && p.x <= fx + 24 && !p.poleSlide && p.py < 200) {
    // 触杆
    var py = p.py;
    var pts, hs;
    if (py < 0x22) { pts = 5000; }
    else if (py < 0x50) { pts = 2000; }
    else if (py < 0x68) { pts = 800; }
    else if (py < 0x90) { pts = 400; }
    else { pts = 100; }
    this.addScore(pts, fx, py);
    p.startPoleSlide(fx);
    this.state = ST.FLAG;
    this.flagSeq = 0;
    // 杆旗下降
    this.flagY = 56;
    AudioSys.stopMusic();
    AudioSys.playMusic("jingle_flagpole", { loop: false });
    this.timeBonusPending = this.time;
  }
};

Game.prototype.poleBottomReached = function () {
  var p = this.player;
  p.poleSlide = false;
  p.dir = 1;
  p.x += 14;
  this.state = ST.CASTLE_WALK;
  this.walkTimer = 0;
};

Game.prototype.updateFlagSequence = function () {
  var p = this.player;
  switch (this.state) {
    case ST.FLAG:
      if (this.flagY < 168) this.flagY += 2;
      break;
    case ST.CASTLE_WALK:
      p.x += 1.5;
      if (this.level.castleX >= 0 && p.x > this.level.castleX * 16 + 24) {
        this.state = ST.TIMECOUNT;
        this.timeCountTimer = 0;
        AudioSys.playMusic("jingle_castle", { loop: false });
      }
      break;
    case ST.TIMECOUNT:
      // 时间换分
      if (this.time > 0) {
        if ((this.frame & 3) === 0) {
          this.time--;
          this.addScore(50);
          if ((this.time & 3) === 0) AudioSys.playSfx("sfx_coin");
        }
      } else {
        this.timeCountTimer++;
        if (this.timeCountTimer > 90) {
          this.state = ST.LEVEL_END;
          this.levelEndTimer = 0;
        }
      }
      break;
    case ST.LEVEL_END:
      this.levelEndTimer++;
      if (this.levelEndTimer > 30) this.nextLevel();
      break;
  }
};

Game.prototype.nextLevel = function () {
  this.checkpoint = null;
  var w = this.world, a = this.area;
  var mainCount = 4;
  var maxWorld = this.ds.worldCount - 1; // smb1:7, smb2j:12(D)
  if (a >= mainCount) {
    a = this.mainAreaState ? this.mainAreaState.area : 0;
  } else {
    a++;
    if (a >= mainCount) { a = 0; w++; }
  }
  this.world = w; this.area = a;
  this.mainAreaState = null;
  if (w > maxWorld) {
    this.state = ST.WIN;
    AudioSys.playMusic("jingle_worldclear", { loop: false });
    this.winTimer = 0;
    return;
  }
  this.state = ST.INTRO;
  this.introTimer = 0;
};

// 检查中途点
Game.prototype.checkCheckpoint = function () {
  var L = this.level;
  if (!this.checkpoint && this.area < 4) {
    var pages = LEVEL_TABLES.HalfwayPageNybbles;
    var worldOff = LEVEL_TABLES.WorldAddrOffsets[this.world];
    var idx = worldOff + this.area;
    var b = pages[idx];
    if (b !== undefined && b > 0) {
      var page = b >> 4;
      if (this.scrollX > page * 256) {
        this.checkpoint = { area: this.area, px: page * 256 + 16, scrollX: page * 256 };
      }
    }
  }
};

// ============ 水管入口 ============
Game.prototype.checkPipeEnter = function () {
  var p = this.player;
  if (!this.input.down || !p.onGround) return;
  var L = this.level;
  var row = Math.floor((p.py + p.height()) / 16);
  // 双脚均须站在可进入管顶(原版: 左脚0x10 右脚0x11)
  var lcol = Math.floor((p.x + 2) / 16), rcol = Math.floor((p.x + 10) / 16);
  if (L.at(lcol, row) === 0x10 && L.at(rcol, row) === 0x11) {
    if (this.currentWarp) this.enterPipe(this.currentWarp);
  }
};

Game.prototype.enterPipe = function (w) {
  var p = this.player;
  AudioSys.playSfx("sfx_pipe");
  // 保存主关状态(首次离开主关时)
  if (this.area < 4 && !this.mainAreaState) {
    this.mainAreaState = {
      area: this.area,
      px: p.x, py: p.py,
      scrollX: this.scrollX,
      time: this.time,
    };
  }
  this.pipeAnim = { phase: 0, timer: 0, warp: w };
  this.state = ST.PIPE;
};

Game.prototype.updatePipeAnim = function () {
  var p = this.player;
  var pa = this.pipeAnim;
  pa.timer++;
  if (pa.timer < 40) {
    p.py += 0.5; // 下沉进管
    return;
  }
  var w = pa.warp;
  this.pipeAnim = null;
  this.loadAreaByPointer(w.destArea, {
    px: w.destPage * 256 + 24,
    keepTime: true,
    bonus: true,
  });
  this.player.x = w.destPage * 256 + 24;
  this.player.py = 32;
  this.snapPlayerToGround();
  this.scrollX = Math.max(0, this.player.x - 80);
};

// 奖励区终点: 走到出口侧管 → 返回主关
Game.prototype.checkBonusExit = function () {
  var L = this.level;
  if (!this.mainAreaState) return;
  var p = this.player;
  // 出口侧管: 玩家右侧撞到侧管瓦片(0x1c..0x21)且在向右走
  var col = Math.floor((p.x + 13) / 16);
  var rowM = Math.floor((p.py + p.height() / 2) / 16);
  var mt = L.at(col, rowM);
  if (mt >= 0x1c && mt <= 0x21 && this.input.right) {
    // 用本区的 warp(回到主关某页)
    var w = this.currentWarp;
    var m = this.mainAreaState;
    this.mainAreaState = null;
    AudioSys.playSfx("sfx_pipe");
    if (w && (w.worldCond === this.world)) {
      this.loadAreaByPointer(w.destArea, { px: w.destPage * 256 + 24, keepTime: true });
      this.player.x = w.destPage * 256 + 24;
    } else {
      this.loadArea(this.world, m.area, { px: m.px, scrollX: m.scrollX, keepTime: true });
    }
    this.snapPlayerToGround();
    this.player.py = Math.min(this.player.py, 160);
    this.scrollX = Math.max(0, this.player.x - 80);
  }
};

// ============ 主更新 ============
Game.prototype.update = function () {
  this.frame++;
  window.__gameFrame = this.frame;
  var inp = this.input, pin = this.prevInput;

  switch (this.state) {
    case ST.VERSION_SELECT:
      this.updateVersionSelect(inp, pin);
      break;
    case ST.TITLE:
      this.updateTitle(inp, pin);
      break;
    case ST.INTRO:
      this.introTimer++;
      if (this.charSel && this.introTimer < 0) {
        // SMB2J 角色选择(前 240 帧)
        if ((this.input.up && !this.prevInput.up) || (this.input.down && !this.prevInput.down)) {
          this.character = this.character === 0 ? 1 : 0;
          this.applyPhysics();
        }
      } else if (this.introTimer > 150) {
        this.charSel = false;
        this.loadArea(this.world, this.area, this.checkpoint ? { px: this.checkpoint.px, scrollX: this.checkpoint.scrollX } : {});
      }
      break;
    case ST.PLAYING:
      this.updatePlaying(inp, pin);
      break;
    case ST.DYING:
      this.player.update(inp, pin);
      this.updateParticles();
      break;
    case ST.PIPE:
      this.updatePipeAnim();
      break;
    case ST.FLAG: case ST.CASTLE_WALK: case ST.TIMECOUNT: case ST.LEVEL_END:
      this.player.update(inp, pin);
      this.updateEnemies();
      this.updateItems();
      this.updateFireballs();
      this.updateParticles();
      this.updateFlagSequence();
      break;
    case ST.GAMEOVER:
      this.gameOverTimer++;
      if (this.gameOverTimer > 240) { this.state = ST.TITLE; }
      break;
    case ST.WIN:
      this.winTimer++;
      if (this.winTimer > 600) { this.state = ST.TITLE; }
      break;
  }
  this.prevInput = {};
  for (var k in this.input) this.prevInput[k] = this.input[k];
};

Game.prototype.updateTitle = function (inp, pin) {
  if (inp.start && !pin.start) {
    AudioSys.unlock();
    // SMB2J: 角色选择
    if (this.ds.features.luigi) {
      this.state = ST.INTRO;
      this.charSel = true;
      this.startGame();
      this.introTimer = -240; // 角色选择阶段(负计时)
    } else {
      this.startGame();
    }
  }
  if (inp.down && !pin.down || inp.up && !pin.up) {
    this.character = this.character === 0 ? 1 : 0;
    this.applyPhysics();
  }
};

Game.prototype.updatePlaying = function (inp, pin) {
  var p = this.player;
  // Start 暂停(原版行为)
  if (inp.start && !pin.start) {
    this.paused = !this.paused;
    AudioSys.stopMusic();
    if (!this.paused) this.playAreaMusic();
  }
  if (this.paused) { return; }
  // 计时
  this.timeFrames++;
  if (this.timeFrames >= 24) {
    this.timeFrames = 0;
    this.time--;
    if (this.time === 100 && !this.timeWarned) {
      this.timeWarned = true;
      AudioSys.stopMusic();
      AudioSys.playMusic("jingle_hurry", { loop: false });
      this.hurryFrames = 160;
    }
    if (this.time <= 0) {
      this.killPlayer();
      return;
    }
  }
  if (this.hurryFrames > 0) {
    this.hurryFrames--;
    if (this.hurryFrames === 0) this.playAreaMusic();
  }

  p.update(inp, pin);
  p.updateAnim();

  // 掉进坑里检测
  if (!p.dead && p.py > 240) {
    this.killPlayer();
    return;
  }

  this.updateSpawns();
  this.updateEnemies();
  this.updateItems();
  this.updateFireballs();
  this.updateParticles();
  this.updateBlocks();
  this.playerEnemyCollide();
  this.playerItemCollide();
  this.checkFlagpole();
  this.checkPipeEnter();
  this.checkBonusExit();
  this.checkCheckpoint();
  this.updateScroll();
  if (this.stompTimer > 0) { this.stompTimer--; if (this.stompTimer === 0) this.stompChain = 0; }
  if (p.onGround && this.stompTimer === 0 && this.stompChain > 0 && p.ys === 0) this.stompChain = 0;
  this.updateWind();
};

// SMB2J 逆风: 地面关周期阵风把玩家向右推
Game.prototype.updateWind = function () {
  if (!this.ds.features.wind || !this.level.wind) return;
  if (this.level.areaType !== 1) return;
  this.windPhase++;
  // 阵风: 32帧周期, 前16帧吹
  var gust = (this.windPhase % 160) < 96;
  if (!gust) return;
  var p = this.player;
  if (p.dead) return;
  if ((this.frame & 3) === 0) {
    p.x += 1; // 每4帧+1px (原版等效推力)
    if (this.collideWall(p, 1)) p.x -= 1;
  }
};

Game.prototype.updateEnemies = function () {
  for (var i = 0; i < this.enemies.length; i++) {
    var e = this.enemies[i];
    e.update();
    if (e.removed) { this.enemies.splice(i--, 1); continue; }
    // 火球碰敌人
    for (var j = 0; j < this.fireballs.length; j++) {
      var f = this.fireballs[j];
      if (f.removed || e.noCollide || !e.alive) continue;
      if (f.x + 4 > e.x && f.x < e.x + e.w && f.py + 4 > e.py && f.py < e.py + e.h) {
        if (e.kill(0)) {
          this.addScore(100, e.x, e.py);
          AudioSys.playSfx("sfx_kick");
        }
        f.removed = true;
        this.spawnPoof(f.x, f.py);
      }
    }
    // 藤蔓生长
    if (e.kind === "vine") {
      if (e.py > e.vineTop) e.py -= 0.5;
    }
  }
  // 火球计数归还
  this.player.fireballs = this.fireballs.filter(function (f) { return !f.removed; }).length;
  this.fireballs = this.fireballs.filter(function (f) { return !f.removed; });
  this.items = this.items.filter(function (it) { return !it.removed; });
  this.particles = this.particles.filter(function (pt) { return !pt.removed; });
  this.enemies = this.enemies.filter(function (e) { return !e.removed; });
};

Game.prototype.updateItems = function () {
  for (var i = 0; i < this.items.length; i++) this.items[i].update();
};

Game.prototype.updateFireballs = function () {
  for (var i = 0; i < this.fireballs.length; i++) this.fireballs[i].update();
};

Game.prototype.updateParticles = function () {
  for (var i = 0; i < this.particles.length; i++) {
    var pt = this.particles[i];
    pt.update();
    if (pt.kind === "hammer") {
      pt.x += pt.xs; pt.py += pt.ys; pt.ys += 0.2;
      var p = this.player;
      if (p.x + 12 > pt.x && p.x < pt.x + 8 && p.py + p.height() > pt.py && p.py < pt.py + 8) {
        this.hurtPlayer();
        pt.removed = true;
      }
      if (pt.py > 260) pt.removed = true;
    }
  }
  this.particles = this.particles.filter(function (pt) { return !pt.removed; });
};

Game.prototype.updateBlocks = function () {
  for (var k in this.blockAnim) {
    var a = this.blockAnim[k];
    a.timer--;
    if (a.timer <= 0) delete this.blockAnim[k];
  }
};

Game.prototype.updateScroll = function () {
  var p = this.player;
  var L = this.level;
  if (this.scrollLock) return;
  var pScrX = p.x - this.scrollX;
  var maxScroll = Math.max(0, L.widthUsed * 16 - SCREEN_W);
  if (pScrX > 0x70 && this.scrollX < maxScroll) {
    var spd = pScrX > 0x80 ? Math.abs(p.xs) : Math.min(Math.abs(p.xs), 2);
    this.scrollX = Math.min(maxScroll, this.scrollX + spd);
  }
  // 玩家不能向左出屏
  if (p.x < this.scrollX + 2) {
    p.x = this.scrollX + 2;
    if (p.xs < 0) { p.xs = 0; p.xForce = 0; }
  }
};

Game.prototype.onLand = function () {
  this.stompChain = 0;
};

// ============ 渲染 ============
Game.prototype.render = function () {
  var ctx = this.ctx;
  var L = this.level;
  ctx.imageSmoothingEnabled = false;

  switch (this.state) {
    case ST.VERSION_SELECT:
      this.renderVersionSelect(ctx);
      return;
    case ST.TITLE:
      this.renderTitle(ctx);
      return;
    case ST.INTRO:
      this.renderIntro(ctx);
      return;
    case ST.GAMEOVER:
      this.renderHUD(ctx);
      this.renderCenterText(ctx, "GAME OVER");
      return;
    case ST.WIN:
      this.renderHUD(ctx);
      this.renderCenterText(ctx, "THANK YOU MARIO!");
      return;
  }

  if (!L) return;
  // 天空
  var bg = "#5c94fc";
  if (L.areaType === 2 || L.style === 1) bg = "#000000";
  if (L.areaType === 0) bg = L.style === 0 ? "#5c94fc" : "#5c94fc";
  if (L.areaType === 3) bg = "#000000";
  if (L.ceilColor >= 4) bg = ["#5c94fc", "#000", "#000", "#000", "#5c94fc", "#000", "#000", "#000"][L.ceilColor] || "#5c94fc";
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
  // 岩浆色水(城堡)
  if (L.areaType === 3) {
    // 走另外路径: 水的瓦片会覆盖
  }

  // 地图
  var qf = Q_FRAMES[(this.frame >> 3) % 4];
  var cf = COIN_FRAMES[(this.frame >> 3) % 4];
  var scrollCol = Math.floor(this.scrollX / 16);
  var subX = Math.round(this.scrollX) % 16;
  for (var sc = 0; sc < 17; sc++) {
    var col = scrollCol + sc;
    if (col >= L.widthUsed) break;
    for (var row = 0; row < LEVEL_ROWS; row++) {
      var mt = L.at(col, row);
      if (!mt || mt === 0x5f || mt === 0x60) continue;
      var art = null;
      if (this.ds.id === "smb2j") {
        if (mt >= 0xc0 && mt <= 0xc2) art = qf;
        else if (mt === 0xc3 || mt === 0xc4) art = cf;
      } else {
        if (mt === 0xc0 || mt === 0xc1) art = qf;
        else if (mt === 0xc2 || mt === 0xc3) art = cf;
      }
      // 块弹跳动画
      var bounce = this.blockAnim[col + "," + row];
      var dy = 0;
      if (bounce) {
        var t = 16 - bounce.timer;
        dy = -Math.round(Math.sin(Math.PI * t / 16) * 8);
      }
      var tileX = sc * 16 - subX;
      var tileY = row * 16 + 32 + dy;
      drawMetatile(ctx, this.images.tiles, mt, tileX, tileY, art, this.ds.art);
    }
  }

  // 岩浆动画覆盖(城堡关水为岩浆色) — 通过染色
  if (L.areaType === 3) this.tintLava(ctx);

  // 实体
  for (var i = 0; i < this.items.length; i++) this.items[i].draw(ctx, this.scrollX);
  for (var i = 0; i < this.enemies.length; i++) this.enemies[i].draw(ctx, this.scrollX);
  for (var i = 0; i < this.fireballs.length; i++) this.fireballs[i].draw(ctx, this.scrollX);
  for (var i = 0; i < this.particles.length; i++) this.particles[i].draw(ctx, this.scrollX);

  // 旗(杆旗)
  if (L.flagpole && this.state >= ST.FLAG) this.drawPoleFlag(ctx);
  if (L.starflagX >= 0 && (this.state === ST.TIMECOUNT || this.state === ST.LEVEL_END || this.state === ST.CASTLE_WALK)) {
    this.drawCastleFlag(ctx);
  }

  // 风叶(SMB2J)
  this.drawWindLeaves(ctx);

  // 玩家
  this.drawPlayer(ctx);

  this.renderHUD(ctx);
  if (this.paused) drawText(ctx, "PAUSE", 112, 120);
  if (L.scrollZoneCol !== undefined && L.warpZone) this.drawWarpZone(ctx);
};

// SMB2J 风: 阵风期画漂移的树叶
Game.prototype.drawWindLeaves = function (ctx) {
  if (!this.ds.features.wind || !this.level.wind || this.level.areaType !== 1) return;
  var gust = (this.windPhase % 160) < 96;
  if (!gust) return;
  var f = this.frame;
  for (var i = 0; i < 8; i++) {
    var speed = 2 + (i % 3) * 0.7;
    var x = ((f * speed) + i * 47) % 300 - 20;
    var y = 40 + ((i * 37 + f * ((i % 2) ? 0.8 : 1.4)) % 160);
    ctx.fillStyle = i % 2 ? "#80d010" : "#00a800";
    ctx.fillRect(Math.round(x), Math.round(y), 6, 3);
    ctx.fillRect(Math.round(x) + 1, Math.round(y) - 1, 4, 1);
  }
};

Game.prototype.tintLava = function (ctx) {
  // 城堡关: 水(0x86/0x87)显示为岩浆红
  var scrollCol = Math.floor(this.scrollX / 16);
  var subX = Math.round(this.scrollX) % 16;
  var L = this.level;
  ctx.save();
  ctx.globalCompositeOperation = "source-atop";
  ctx.restore();
  // 直接在绘制时替换颜色不可行, 改为叠加深红半透明
  for (var sc = 0; sc < 17; sc++) {
    var col = scrollCol + sc;
    for (var row = 0; row < LEVEL_ROWS; row++) {
      var mt = L.at(col, row);
      if (mt === 0x86 || mt === 0x87) {
        var x = sc * 16 - subX, y = row * 16 + 32;
        ctx.drawImage(this.images.tiles, MT_ART[0x86][0] * 16, MT_ART[0x86][1] * 16, 16, 16, x, y, 16, 16);
        ctx.fillStyle = "rgba(200,40,0,0.55)";
        ctx.fillRect(x, y, 16, 16);
      }
    }
  }
};

Game.prototype.drawPlayer = function (ctx) {
  var p = this.player;
  var pose = p.pose();
  var size = p.status;
  // 变身闪烁
  if (p.frozen > 0 && p.growTimer > 0) {
    var t = p.growTimer;
    if ((t >> 2) & 1) size = p.growDir > 0 ? 0 : 1;
    else size = p.growDir > 0 ? 1 : 0;
  }
  if (p.fireFlash > 0 && ((p.fireFlash >> 2) & 1)) size = 1;
  var fr = marioFrame(size, p.dir < 0 ? 1 : 0, pose);
  var sx = Math.round(p.x - 2 - this.scrollX);
  var sy = Math.round(p.py) + 32;
  // 受伤闪烁
  if (p.injuryBlink > 0 && ((p.injuryBlink >> 3) & 1) && !p.dead) return;
  // 星星调色: 用滤镜近似
  var img = this.images.player;
  if (p.starTimer > 0) {
    var hue = (this.frame >> 1) % 3;
    ctx.save();
    if (hue === 0) ctx.filter = "hue-rotate(120deg)";
    else if (hue === 1) ctx.filter = "hue-rotate(240deg)";
    ctx.drawImage(img, fr.sx, fr.sy, fr.sw, fr.sh, sx, sy, 16, size === 0 ? 16 : 32);
    ctx.restore();
  } else {
    ctx.drawImage(img, fr.sx, fr.sy, fr.sw, fr.sh, sx, sy, 16, size === 0 ? 16 : 32);
  }
};

Game.prototype.drawPoleFlag = function (ctx) {
  var L = this.level;
  var x = L.flagpole.x - this.scrollX;
  // 屏幕范围检查
  if (x < -20 || x > 276) return;
  var y = this.state >= ST.FLAG ? Math.min(this.flagY || 56, 168) : 56;
  // 绿旗(16x16)
  ctx.fillStyle = "#00a800";
  ctx.beginPath();
  ctx.moveTo(x - 16, y);
  ctx.lineTo(x - 1, y + 5);
  ctx.lineTo(x - 16, y + 11);
  ctx.closePath();
  ctx.fill();
};

Game.prototype.drawCastleFlag = function (ctx) {
  var L = this.level;
  if (L.starflagX < 0) return;
  var x = L.starflagX - this.scrollX + 8;
  // 屏幕范围检查
  if (x < -20 || x > 276) return;
  var targetY = 96;
  if (this.castleFlagY === undefined) this.castleFlagY = 176;
  if (this.state === ST.TIMECOUNT) {
    if (this.castleFlagY > targetY) this.castleFlagY -= 1;
  }
  var y = this.castleFlagY;
  ctx.fillStyle = "#fff";
  ctx.fillRect(x - 1, y, 1, 176 - y);
  ctx.fillStyle = "#e45c10";
  ctx.beginPath();
  ctx.moveTo(x + 1, y);
  ctx.lineTo(x + 12, y + 4);
  ctx.lineTo(x + 1, y + 8);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#00a800";
  ctx.beginPath();
  ctx.moveTo(x + 1, y + 4);
  ctx.lineTo(x + 8, y + 8);
  ctx.lineTo(x + 1, y + 12);
  ctx.closePath();
  ctx.fill();
};

Game.prototype.drawWarpZone = function (ctx) {
  var L = this.level;
  var x = L.scrollZoneCol * 16 - this.scrollX;
  if (x < -80 || x > 260) return;
  var labels = ["4  3  2", "5", "8  7  6"];
  drawText(ctx, "WELCOME TO WARP ZONE!", x - 40, 96);
  drawText(ctx, labels[(L.warpZone || 1) - 1], x - 8, 160);
};

Game.prototype.drawItemSprite = function (ctx, kind, sx, sy, t) {
  var img = this.images.tiles;
  if (kind === "poison") {
    // 毒蘑菇: 暗紫帽 — 长得像蘑菇, 吃了受伤(原版陷阱)
    ctx.fillStyle = "#7c3000"; ctx.fillRect(sx + 2, sy + 5, 12, 6);
    ctx.fillStyle = "#c8a080"; ctx.fillRect(sx + 5, sy + 8, 2, 2); ctx.fillRect(sx + 9, sy + 8, 2, 2);
    ctx.fillStyle = "#8b1a8b";
    ctx.fillRect(sx + 3, sy + 3, 10, 3); ctx.fillRect(sx + 2, sy + 4, 12, 2);
    ctx.fillRect(sx + 4, sy + 2, 8, 1); ctx.fillRect(sx + 5, sy + 1, 6, 1);
    ctx.fillStyle = "#4a1a4a";
    ctx.fillRect(sx + 4, sy + 4, 2, 2); ctx.fillRect(sx + 7, sy + 3, 2, 2); ctx.fillRect(sx + 10, sy + 4, 2, 2);
    return;
  }
  if (kind === "mushroom" || kind === "oneup") {
    // 蘑菇: 帽+脸 (程序绘制, 原版样式)
    var cap = kind === "mushroom" ? "#d82800" : "#00a800";
    ctx.fillStyle = "#fca044"; ctx.fillRect(sx + 2, sy + 5, 12, 6); // 柄
    ctx.fillStyle = "#fff"; ctx.fillRect(sx + 5, sy + 8, 2, 2); ctx.fillRect(sx + 9, sy + 8, 2, 2);
    ctx.fillStyle = cap;
    ctx.fillRect(sx + 3, sy + 3, 10, 3); ctx.fillRect(sx + 2, sy + 4, 12, 2);
    ctx.fillRect(sx + 4, sy + 2, 8, 1); ctx.fillRect(sx + 5, sy + 1, 6, 1);
    ctx.fillStyle = "#fff";
    ctx.fillRect(sx + 4, sy + 4, 2, 2); ctx.fillRect(sx + 7, sy + 3, 2, 2); ctx.fillRect(sx + 10, sy + 4, 2, 2);
  } else if (kind === "flower") {
    var cyc = ["#d82800", "#ff8c00", "#fff", "#ff8c00"][(t >> 3) % 4];
    ctx.fillStyle = "#00a800";
    ctx.fillRect(sx + 3, sy + 9, 2, 4); ctx.fillRect(sx + 11, sy + 9, 2, 4);
    ctx.fillRect(sx + 6, sy + 10, 4, 4);
    ctx.fillStyle = cyc;
    ctx.fillRect(sx + 5, sy + 4, 6, 5); ctx.fillRect(sx + 6, sy + 3, 4, 7);
    ctx.fillStyle = "#fff";
    ctx.fillRect(sx + 7, sy + 5, 2, 2);
  } else if (kind === "star") {
    var blink = ["#fcfcfc", "#f8b800", "#fc9838"][(t >> 2) % 3];
    ctx.fillStyle = blink;
    // 五角星像素
    ctx.fillRect(sx + 7, sy + 1, 2, 5);
    ctx.fillRect(sx + 4, sy + 4, 8, 3);
    ctx.fillRect(sx + 2, sy + 6, 12, 2);
    ctx.fillRect(sx + 4, sy + 8, 3, 5);
    ctx.fillRect(sx + 9, sy + 8, 3, 5);
    ctx.fillStyle = "#000";
    ctx.fillRect(sx + 5, sy + 6, 2, 2); ctx.fillRect(sx + 9, sy + 6, 2, 2);
  }
};

// ============ HUD ============
Game.prototype.renderHUD = function (ctx) {
  drawText(ctx, "MARIO", 16, 8);
  drawText(ctx, pad(this.score, 6), 16, 16);
  // 金币图标×NN
  var cf = COIN_FRAMES[(this.frame >> 3) % 4];
  ctx.drawImage(this.images.tiles, cf[0] * 16, cf[1] * 16, 16, 16, 72, 16, 8, 8);
  drawText(ctx, "×" + pad(this.coins, 2), 82, 16);
  drawText(ctx, "WORLD", 144, 8);
  drawText(ctx, this.worldLabel() + "-" + (this.area + 1), 152, 16);
  drawText(ctx, "TIME", 200, 8);
  drawText(ctx, pad(this.time, 3), 208, 16);
};

Game.prototype.worldLabel = function () {
  if (this.ds.id === "smb2j" && this.world >= 8) {
    return ["9", "A", "B", "C", "D"][this.world - 8];
  }
  return String(this.world + 1);
};

Game.prototype.renderIntro = function (ctx) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
  this.renderHUD(ctx);
  drawText(ctx, "WORLD " + this.worldLabel() + "-" + (this.area + 1), 88, 80);
  var img = this.images.player;
  var fr = marioFrame(0, 0, "idle");
  ctx.drawImage(img, fr.sx, fr.sy, fr.sw, fr.sh, 96, 104, 16, 16);
  drawText(ctx, "× " + this.lives, 120, 108);
  if (this.ds.features.luigi) {
    // 角色选择
    drawText(ctx, this.character === 0 ? ">MARIO" : " MARIO", 72, 152);
    drawText(ctx, this.character === 1 ? ">LUIGI" : " LUIGI", 136, 152);
    drawText(ctx, "UP/DOWN TO CHOOSE", 56, 176);
  }
};

var VERSION_ENTRIES = [
  { id: "smb1", title: "SUPER MARIO BROS.", sub: "1985 ORIGINAL 32 LEVELS", ok: true },
  { id: "smb2j", title: "THE LOST LEVELS", sub: "1986 JAPAN ONLY SEQUEL", ok: true },
  { id: "smb3", title: "SUPER MARIO BROS. 3", sub: "COMING SOON", ok: false },
  { id: "smw", title: "SUPER MARIO WORLD", sub: "COMING SOON", ok: false },
];

Game.prototype.updateVersionSelect = function (inp, pin) {
  if ((inp.down && !pin.down) || (inp.right && !pin.right)) {
    this.menuIdx = Math.min(this.menuIdx + 1, VERSION_ENTRIES.length - 1);
  }
  if ((inp.up && !pin.up) || (inp.left && !pin.left)) {
    this.menuIdx = Math.max(this.menuIdx - 1, 0);
  }
  if (inp.start && !pin.start) {
    AudioSys.unlock();
    var e = VERSION_ENTRIES[this.menuIdx];
    if (e.ok) {
      this.version = e.id;
      this.ds = DATASETS[e.id];
      this.state = ST.TITLE;
    }
  }
};

Game.prototype.renderVersionSelect = function (ctx) {
  ctx.fillStyle = "#101018";
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
  drawText(ctx, "SELECT GAME", 92, 24);
  // 标题装饰
  var cf = COIN_FRAMES[(this.frame >> 3) % 4];
  ctx.drawImage(this.images.tiles, cf[0] * 16, cf[1] * 16, 16, 16, 16, 18, 12, 12);
  ctx.drawImage(this.images.tiles, cf[0] * 16, cf[1] * 16, 16, 16, 228, 18, 12, 12);
  var y = 56;
  for (var i = 0; i < VERSION_ENTRIES.length; i++) {
    var e = VERSION_ENTRIES[i];
    var sel = i === this.menuIdx;
    if (sel) {
      ctx.fillStyle = "#2a2a4a";
      ctx.fillRect(16, y - 4, 224, 30);
    }
    // 光标
    if (sel) {
      var cf2 = COIN_FRAMES[(this.frame >> 3) % 4];
      ctx.drawImage(this.images.tiles, cf2[0] * 16, cf2[1] * 16, 16, 16, 24, y + 2, 12, 12);
    }
    if (e.ok) {
      drawText(ctx, e.title, 44, y);
      drawText(ctx, e.sub, 44, y + 12);
    } else {
      ctx.save();
      ctx.globalAlpha = 0.45;
      drawText(ctx, e.title, 44, y);
      drawText(ctx, e.sub, 44, y + 12);
      ctx.restore();
    }
    y += 40;
  }
  drawText(ctx, "UP/DOWN SELECT  ENTER OK", 40, 220);
};

Game.prototype.renderTitle = function (ctx) {
  ctx.fillStyle = "#5c94fc";
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
  var t = this.images.title;
  if (t) {
    // title.png 为 352x176 宽幅版: 取上部主体(含logo与版权行), 等比缩到256宽
    var srcH = 150;
    var scale = 256 / 352;
    var destH = Math.round(srcH * scale);
    ctx.drawImage(t, 0, 0, 352, srcH, 0, 16, 256, destH);
  }
  drawText(ctx, "1 PLAYER GAME", 88, 160);
  drawText(ctx, "TOP- " + pad(this.topScore, 6), 88, 180);
  var cf = COIN_FRAMES[(this.frame >> 3) % 4];
  ctx.drawImage(this.images.tiles, cf[0] * 16, cf[1] * 16, 16, 16, 72, 158, 10, 10);
  drawText(ctx, "PRESS ENTER TO START", 48, 204);
};

Game.prototype.renderCenterText = function (ctx, text) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
  this.renderHUD(ctx);
  drawText(ctx, text, (256 - text.length * 8) / 2, 120);
};

function pad(n, len) {
  n = String(Math.max(0, n | 0));
  while (n.length < len) n = " " + n;
  return n;
}
