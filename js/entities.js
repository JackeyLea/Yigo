// entities.js — 敌人/物品/火球/粒子系统
// 速度常量: 普通敌 0.5px/帧, 壳 3.0, 炮弹 1.5, 火球 4.0, 蘑菇 0.5(跳跃式), 星弹跳

var ENEMY_DEFS = {
  0x00: { kind: "koopa", w: 14, h: 24, score: 100 },
  0x02: { kind: "buzzy", w: 14, h: 24, score: 100 },   // 甲虫(防火球)
  0x03: { kind: "koopaRed", w: 14, h: 24, score: 100 }, // 红龟不掉台
  0x05: { kind: "hammerBro", w: 14, h: 24, score: 1000 },
  0x06: { kind: "goomba", w: 14, h: 14, score: 100 },
  0x07: { kind: "bloober", w: 14, h: 14, score: 100, water: true },
  0x0a: { kind: "cheepGrey", w: 14, h: 14, score: 200, water: true },
  0x0b: { kind: "cheepRed", w: 14, h: 14, score: 200, water: true },
  0x0c: { kind: "podoboo", w: 12, h: 14, score: 200, lava: true },
  0x0d: { kind: "piranha", w: 14, h: 24, score: 200 },
  0x0e: { kind: "koopaJump", w: 14, h: 24, score: 100 },
  0x0f: { kind: "koopaFlyV", w: 14, h: 22, score: 400 },
  0x10: { kind: "koopaFlyH", w: 14, h: 22, score: 100 },
  0x11: { kind: "lakitu", w: 14, h: 14, score: 800 },
  0x12: { kind: "spiny", w: 14, h: 14, score: 200 },
  0x14: { kind: "flyingCheep", w: 14, h: 14, score: 200 },
  0x15: { kind: "bowserFire", w: 14, h: 8, noCollide: true },
  0x1b: { kind: "firebarShort", w: 8, h: 8, noCollide: true },
  0x1c: { kind: "firebarLong", w: 8, h: 8, noCollide: true },
  0x1d: { kind: "firebarMed", w: 8, h: 8, noCollide: true },
  0x24: { kind: "platformH", w: 16, h: 8, noCollide: true },
  0x25: { kind: "platformV", w: 16, h: 8, noCollide: true },
  0x26: { kind: "platformDrop", w: 16, h: 8, noCollide: true },
  0x27: { kind: "platformHLift", w: 16, h: 8, noCollide: true },
  0x28: { kind: "platformVLift", w: 16, h: 8, noCollide: true },
  0x29: { kind: "platformTree", w: 48, h: 8, noCollide: true },
  0x2a: { kind: "platformScale", w: 48, h: 8, noCollide: true },
  0x2d: { kind: "bowser", w: 28, h: 24, score: 5000 },
  0x2f: { kind: "vine", w: 8, h: 8, noCollide: true },
  0x30: { kind: "poleFlag", w: 16, h: 16, noCollide: true },
  0x31: { kind: "starFlag", w: 16, h: 16, noCollide: true },
  0x32: { kind: "spring", w: 16, h: 16, noCollide: true },
  0x33: { kind: "cannon", w: 16, h: 16, noCollide: true },
};

var F = ENEMY_FRAMES;

function Enemy(game, id, x, py, opts) {
  opts = opts || {};
  this.game = game;
  this.id = id;
  var def = ENEMY_DEFS[id] || { kind: "goomba", w: 14, h: 14, score: 100 };
  this.kind = def.kind;
  this.w = def.w; this.h = def.h;
  this.score = def.score;
  this.x = x; this.py = py;
  this.xs = -0.5; this.ys = 0;
  this.yForce = 0;
  this.state = 0;          // 0活动 4壳 5壳滑 8被顶翻 0xd5踩扁...
  this.alive = true;
  this.removed = false;
  this.animTimer = 0;
  this.frame = 0;
  this.timer = 0;          // 壳苏醒/各种计时
  this.grav = true;
  this.stomped = false;
  this.flip = false;        // 被顶翻
  this.noCollide = !!def.noCollide;
  this.carried = false;
  this.homeY = py;
  this.homeX = x;
  this.shellChain = 0;
  this.init();
}

Enemy.prototype.init = function () {
  var g = this.game;
  switch (this.kind) {
    case "goomba":
    case "buzzy":
      break;
    case "koopa":
    case "koopaRed":
      break;
    case "koopaFlyV": // 垂直飞(红带翅)
      this.yBase = this.py; this.yPhase = 0;
      this.flyDir = 1;
      break;
    case "koopaFlyH": // 水平飞(绿带翅)
      this.xCounter = 0;
      break;
    case "koopaJump": // 跳跃绿龟
      this.ys = -3;
      break;
    case "piranha":
      this.py = this.homeY; // 管口
      this.yTop = this.homeY - 24;
      this.phase = 0; // 0收 1升 2出 3降
      this.posY = this.homeY;
      this.wait = 64;
      break;
    case "podoboo":
      this.ys = opts_podobooSpeed(this);
      this.py = this.homeY;
      break;
    case "cheepRed": case "cheepGrey":
      this.xs = -1; this.ys = (this.py < 120) ? 1 : -1;
      break;
    case "flyingCheep":
      this.xs = -1.5;
      this.ys = (g.player.py > this.py) ? -2.5 : -3.5;
      break;
    case "bloober":
      this.sinkTimer = 0;
      break;
    case "lakitu":
      this.xs = 0;
      this.spinyTimer = 120;
      break;
    case "hammerBro":
      this.hammerTimer = 48;
      this.shimmy = 0;
      this.jumpTimer = 0;
      break;
    case "bowser":
      this.xs = -0.5;
      this.hp = 5;
      this.fireTimer = 120;
      this.moveDir = -1;
      this.hopTimer = 0;
      break;
    case "firebarShort": case "firebarMed": case "firebarLong":
      this.angle = (this.x % 2) ? 0 : 128;
      this.len = this.kind === "firebarLong" ? 12 : (this.kind === "firebarMed" ? 6 : 3);
      this.spin = 2;
      break;
    case "platformH": case "platformV": case "platformHLift": case "platformVLift":
      this.base = this.py; this.basex = this.x;
      break;
    case "bullet":
      break;
  }
};
function opts_podobooSpeed(e) { return (e.seed % 2) ? -2.5 : -3; }

Enemy.prototype.centerX = function () { return this.x + this.w / 2; };
Enemy.prototype.centerY = function () { return this.py + this.h / 2; };

Enemy.prototype.update = function () {
  var g = this.game;
  if (this.removed) return;
  if (!this.alive) {
    // 被顶翻/被壳撞飞
    this.py += this.ys;
    this.x += this.xs;
    this.ys = Math.min(this.ys + 0.3, 4);
    if (this.py > 260) this.removed = true;
    return;
  }
  this.animTimer++;
  switch (this.kind) {
    case "goomba": case "buzzy": this.updateWalker(); break;
    case "koopa": case "koopaRed": this.updateKoopa(); break;
    case "koopaFlyV": this.updateFlyV(); break;
    case "koopaFlyH": this.updateFlyH(); break;
    case "koopaJump": this.updateJumper(); break;
    case "piranha": this.updatePiranha(); return; // 无碰撞移动
    case "podoboo": this.updatePodoboo(); return;
    case "cheepRed": case "cheepGrey": case "flyingCheep": this.updateCheep(); return;
    case "bloober": this.updateBloober(); return;
    case "lakitu": this.updateLakitu(); break;
    case "spiny": this.updateWalker(); break;
    case "hammerBro": this.updateHammerBro(); break;
    case "bowser": this.updateBowser(); return;
    case "bowserFire": this.x -= 1.5; this.checkOffscreen(); return;
    case "firebarShort": case "firebarMed": case "firebarLong":
      this.angle = (this.angle + this.spin) & 0xff; return;
    case "bullet": this.x += this.xs; this.checkOffscreen(); return;
    case "platformH": case "platformHLift": this.updatePlatformH(); return;
    case "platformV": case "platformVLift": this.updatePlatformV(); return;
    default: break;
  }
  // 通用: 重力 + 移动 + 墙/平台碰撞
  if (this.grav && this.state !== 4 && !this.carried) {
    this.yForce += 0x3d;
    while (this.yForce >= 256) { this.yForce -= 256; this.ys++; }
    if (this.ys > 3) { this.ys = 3; this.yForce = 0; }
  }
  this.moveWithCollision();
  this.checkOffscreen();
};

Enemy.prototype.moveWithCollision = function () {
  var g = this.game;
  // 水平
  var dx = this.xs;
  if (dx !== 0) {
    var dir = Math.sign(dx);
    this.x += dx;
    if (g.enemyWall(this, dir)) {
      this.x -= dx;
      this.xs = -this.xs;
    }
  }
  // 垂直
  var dy = this.ys;
  if (dy > 0) {
    this.py += dy;
    if (g.enemyFloor(this)) {
      this.py = Math.floor((this.py + this.h) / 16) * 16 - this.h;
      this.ys = 0; this.yForce = 0;
    }
  } else if (dy < 0) {
    this.py += dy;
    // 上升撞头(绿龟跳等忽略)
  }
  // 红龟/部分敌人: 平台边缘检测
  if (this.kind === "koopaRed" && this.state === 0 && this.ys === 0) {
    if (!g.enemyLedge(this)) this.xs = -this.xs;
  }
  // 敌人互撞转向
  g.enemyEnemyCollide(this);
};

Enemy.prototype.updateWalker = function () {
  if (this.stomped) {
    this.timer++;
    if (this.timer > 30) this.removed = true;
    return;
  }
  if (this.state === 4) { // 壳
    this.xs = 0;
    this.timer++;
    if (this.timer > 336) { // 苏醒
      this.state = 0;
      this.kind = this.kind === "buzzy" ? "buzzy" : "koopa";
      this.xs = 0.5;
    }
    return;
  }
  if (this.state === 5) { // 壳滑
    this.xs = this.slidingDir * 3;
    return;
  }
};

Enemy.prototype.updateKoopa = function () { this.updateWalker(); };

Enemy.prototype.updateFlyV = function () {
  // 垂直往返
  this.py += this.flyDir * 1;
  if (this.py < this.homeY - 48) this.flyDir = 1;
  if (this.py > this.homeY + 32) this.flyDir = -1;
  this.xs = -0.5;
  this.moveWithCollision();
  this.checkOffscreen();
};

Enemy.prototype.updateFlyH = function () {
  // 水平往返 + 上下波动
  this.xCounter = (this.xCounter || 0) + 1;
  if ((this.xCounter & 3) === 0) {
    this.x += this.horizDir || -1;
    if (this.x < this.homeX - 64) this.horizDir = 1;
    if (this.x > this.homeX + 64) this.horizDir = -1;
  }
  this.py = this.homeY + (((g_frame() >> 2) & 1) ? 8 : 0) - 4;
  this.checkOffscreen();
};
function g_frame() { return window.__gameFrame || 0; }

Enemy.prototype.updateJumper = function () {
  if (this.ys === 0 && this.onG) {
    this.ys = -3;
  }
};

Enemy.prototype.updatePiranha = function () {
  var g = this.game;
  var p = g.player;
  // 马里奥水平距离<33px 不出来
  if (this.phase === 0 || this.phase === 3) {
    if (Math.abs(p.x + 6 - this.centerX()) < 33 && this.py === this.homeY) {
      return; // 保持收起
    }
  }
  switch (this.phase) {
    case 0: // 升起
      this.wait = 64; this.phase = 1;
      break;
    case 1:
      this.py -= 0.5;
      if (this.py <= this.yTop) { this.py = this.yTop; this.phase = 2; this.wait = 64; }
      break;
    case 2:
      this.wait--;
      if (this.wait <= 0) this.phase = 3;
      break;
    case 3:
      this.py += 0.5;
      if (this.py >= this.homeY) { this.py = this.homeY; this.phase = 0; }
      break;
  }
};

Enemy.prototype.updatePodoboo = function () {
  this.py += this.ys;
  this.yForce += 0x28;
  while (this.yForce >= 256) { this.yForce -= 256; this.ys++; }
  if (this.py > this.homeY && this.ys > 0) {
    this.py = this.homeY; this.ys = (Math.floor(this.x / 8) % 2) ? -3 : -2.5;
    this.yForce = 0;
  }
  if (this.py < 40 && this.ys < 0) { /* 顶点后自然下落 */ }
};

Enemy.prototype.updateCheep = function () {
  this.x += this.xs;
  this.py += this.ys;
  if (this.kind === "flyingCheep") {
    this.yForce = (this.yForce || 0) + 0x10;
    while (this.yForce >= 256) { this.yForce -= 256; this.ys++; }
    if (this.py > 260) this.removed = true;
  } else {
    if (this.py < 48) this.ys = Math.abs(this.ys);
    if (this.py > 208) this.ys = -Math.abs(this.ys);
  }
  this.checkOffscreen();
};

Enemy.prototype.updateBloober = function () {
  var g = this.game, p = g.player;
  // 每8帧改变下沉速度
  var t = (g.frame >> 3) & 3;
  this.ys = [0, 1, 2, 2][t] * 0.75;
  if (this.py > 64) this.ys = -1.5; // 上浮段
  // 简化: 周期性下潜上浮
  var cyc = (g.frame + ((this.x / 16) | 0) * 7) % 96;
  if (cyc < 48) { this.ys = -1; } else { this.ys = 1.2; }
  if (this.py < 40) this.ys = 1.2;
  if (this.py > 200) this.ys = -1;
  this.py += this.ys;
  // 水平追踪
  var tx = p.x + 6;
  if (Math.abs(tx - this.x) > 8) this.x += Math.sign(tx - this.x) * 0.5;
  this.checkOffscreen();
};

Enemy.prototype.updateLakitu = function () {
  var g = this.game, p = g.player;
  var diff = (p.x + 6) - this.x;
  var spd = 0;
  if (Math.abs(diff) > 24) spd = Math.sign(diff) * Math.min(Math.abs(diff) / 24, 2);
  this.x += spd;
  // 扔刺猬
  this.spinyTimer--;
  if (this.spinyTimer <= 0 && Math.abs(diff) < 120) {
    this.spinyTimer = 180 + ((Math.random() * 60) | 0);
    g.spawnEnemy(0x12, this.x, this.py + 8, { spinyEgg: true });
  }
};

Enemy.prototype.updateHammerBro = function () {
  var g = this.game, p = g.player;
  // 跳跃与平移
  this.jumpTimer = (this.jumpTimer || 0) - 1;
  if (this.ys === 0 && this.jumpTimer <= 0) {
    if (Math.random() < 0.02) {
      this.ys = Math.random() < 0.5 ? -4 : -2.5;
      this.jumpTimer = 150;
    }
  }
  // 左右踱步
  this.shimmy = (this.shimmy + 1) % 128;
  var want = this.shimmy < 64 ? -0.25 : 0.25;
  if (this.ys === 0) this.xs = want; else this.xs = 0;
  // 扔锤
  this.hammerTimer--;
  if (this.hammerTimer <= 0 && Math.abs(p.x - this.x) < 160) {
    this.hammerTimer = 28 + ((Math.random() * 20) | 0);
    g.spawnHammer(this.x, this.py - 8);
  }
};

Enemy.prototype.updateBowser = function () {
  var g = this.game, p = g.player;
  // 移动: 向马里奥逼近-后退
  var diff = p.x - this.x;
  if (this.hopTimer > 0) this.hopTimer--;
  else if (this.ys === 0 && Math.random() < 0.008) {
    this.ys = -4; this.hopTimer = 90;
  }
  if (Math.abs(diff) > 80) this.xs = Math.sign(diff) * 0.5;
  else this.xs = 0;
  // 喷火
  this.fireTimer--;
  if (this.fireTimer <= 0) {
    this.fireTimer = 100 + ((Math.random() * 60) | 0);
    g.spawnBowserFire(this.x - 8, this.py + 4);
  }
  this.moveWithCollision();
};

Enemy.prototype.updatePlatformH = function () {
  var t = this.game.frame + this.basex;
  var range = 48;
  this.x = this.basex + Math.round(Math.sin(t / 128) * range);
  this.py = this.base;
};
Enemy.prototype.updatePlatformV = function () {
  var t = this.game.frame + this.basex;
  var range = 40;
  this.py = this.base + Math.round(Math.sin(t / 128) * range);
};

Enemy.prototype.checkOffscreen = function () {
  var g = this.game;
  var sx = this.x - g.scrollX;
  if (sx < -64 || sx > 320) {
    if (this.kind !== "bowser" && this.kind !== "lakitu") this.removed = true;
  }
  if (this.py > 260) this.removed = true;
};

// 被踩
Enemy.prototype.stomp = function (stompChain) {
  var g = this.game;
  switch (this.kind) {
    case "goomba":
      this.stomped = true; this.timer = 0; this.state = 0xd5;
      break;
    case "koopa": case "koopaRed": case "buzzy":
      if (this.state === 0) {
        this.state = 4; this.timer = 0; this.xs = 0;
        this.kind = this.kind === "buzzy" ? "buzzy" : this.kind; // 保持色
      } else if (this.state === 5) {
        this.state = 4; this.timer = 0; this.xs = 0;
      } else if (this.state === 4) {
        this.state = 5; this.slidingDir = g.player.x + 6 < this.x ? 1 : -1;
        g.addScore(400, this.x, this.py);
        AudioSys.playSfx("sfx_kick");
        return "kick";
      }
      break;
    case "koopaFlyV": case "koopaFlyH":
      // 变普通龟
      this.kind = this.kind === "koopaFlyV" ? "koopaRed" : "koopa";
      break;
    case "koopaJump":
      this.kind = "koopa";
      break;
    case "piranha": case "podoboo": case "bloober":
      break; // 不可踩(踩了受伤/无效)
    case "spiny":
      return "hurt"; // 反伤
    case "hammerBro":
      this.alive = false; this.ys = -3; this.xs = 1;
      break;
    case "lakitu":
      this.alive = false; this.ys = -3; this.xs = 1;
      break;
    case "bullet":
      this.alive = false; this.ys = -3;
      break;
    default:
      this.alive = false; this.ys = -3;
  }
  return "stomp";
};

// 被火球/壳击杀
Enemy.prototype.kill = function (fromShell) {
  var g = this.game;
  if (this.kind === "podoboo" || this.kind === "bowserFire" || this.kind === "bowser") return false;
  if (this.kind === "buzzy" && !fromShell) return false; // 甲虫防火球
  if ((this.kind === "firebarShort" || this.kind === "firebarMed" || this.kind === "firebarLong")) return false;
  this.alive = false;
  this.ys = -3;
  this.xs = fromShell ? (fromShell > 0 ? 1 : -1) : 1;
  return true;
};

Enemy.prototype.draw = function (ctx, scrollX) {
  var sx = Math.round(this.x - scrollX);
  var sy = Math.round(this.py) + 32;
  var fr = null;
  var af = (this.animTimer >> 3) & 1;
  switch (this.kind) {
    case "goomba":
      fr = this.stomped ? F.goombaFlat : (af ? F.goomba1 : F.goomba2);
      if (this.state === 0xd5) fr = F.goombaFlat;
      break;
    case "buzzy": fr = af ? F.buzzy1 : F.buzzy2; if (this.state === 4) fr = F.shellBuzzy; break;
    case "koopa":
      if (this.state === 4 || this.state === 5) fr = F.shell;
      else fr = af ? F.koopa1 : F.koopa2;
      break;
    case "koopaRed":
      if (this.state === 4 || this.state === 5) fr = F.shell;
      else fr = af ? F.koopaR1 : F.koopaR2;
      break;
    case "koopaFlyV": fr = af ? F.koopaR1 : F.koopaR2; break;
    case "koopaFlyH": fr = af ? F.koopa1 : F.koopa2; break;
    case "koopaJump": fr = af ? F.koopa1 : F.koopa2; break;
    case "piranha": fr = ((this.game.frame >> 3) & 1) ? F.piranhaC : F.piranhaO; break;
    case "podoboo": fr = ((this.animTimer >> 2) & 1) ? F.podoboo1 : F.podoboo2; break;
    case "cheepRed": case "flyingCheep": fr = af ? F.cheep1 : F.cheep2; break;
    case "cheepGrey": fr = af ? F.cheep1 : F.cheep2; break;
    case "bloober": fr = [F.bloober1, F.bloober2, F.bloober3][(this.animTimer >> 3) % 3]; break;
    case "lakitu": fr = ((this.game.frame >> 3) & 1) ? F.lakitu1 : F.lakitu2; break;
    case "spiny": fr = af ? F.spiny1 : F.spiny2; break;
    case "hammerBro": fr = (this.hammerTimer < 10) ? F.hammerBro2 : F.hammerBro1; break;
    case "bullet": fr = F.bullet; break;
    case "bowser": fr = ((this.game.frame >> 3) & 1) ? F.bowser1 : F.bowser2; break;
    case "bowserFire": fr = F.bowserFire1; break;
  }
  if (!fr) return;
  var img = this.game.images.enemy;
  // 底部对齐绘制(敌人y为其顶部)
  var drawY = sy - (fr.sh - this.h) / 2;
  if (!this.alive) {
    ctx.save();
    ctx.translate(sx + fr.sw / 2, drawY + fr.sh / 2);
    ctx.scale(1, -1);
    ctx.drawImage(img, fr.sx, fr.sy, fr.sw, fr.sh, -fr.sw / 2, -fr.sh / 2, fr.sw, fr.sh);
    ctx.restore();
  } else {
    if (this.xs > 0 && (this.kind === "cheepRed" || this.kind === "cheepGrey")) {
      ctx.save();
      ctx.translate(sx + fr.sw, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(img, fr.sx, fr.sy, fr.sw, fr.sh, 0, drawY, fr.sw, fr.sh);
      ctx.restore();
    } else {
      ctx.drawImage(img, fr.sx, fr.sy, fr.sw, fr.sh, sx, drawY, fr.sw, fr.sh);
    }
  }
};

// ================= 物品 =================
function Item(game, kind, x, py) {
  this.game = game;
  this.kind = kind; // mushroom flower star oneup coin
  this.x = x; this.py = py;
  this.xs = 0; this.ys = 0;
  this.yForce = 0;
  this.rise = 16;   // 从块中升起
  this.removed = false;
  this.animTimer = 0;
  this.grav = true;
  if (kind === "star") { this.ys = -3; this.xs = 1; }
}

Item.prototype.w = 16; Item.prototype.h = 16;

Item.prototype.update = function () {
  var g = this.game;
  this.animTimer++;
  if (this.rise > 0) {
    this.py -= 1;
    this.rise -= 1;
    if (this.rise === 0 && this.kind === "mushroom") this.xs = 0.5;
    if (this.rise === 0 && this.kind === "oneup") this.xs = 0.5;
    return;
  }
  if (this.kind === "star") {
    // 弹跳
    this.yForce += 0x20;
    while (this.yForce >= 256) { this.yForce -= 256; this.ys++; }
    if (this.ys > 3) this.ys = 3;
    this.py += this.ys;
    if (this.ys > 0 && g.itemFloor(this)) {
      this.py = Math.floor((this.py + 16) / 16) * 16 - 16;
      this.ys = -3; this.yForce = 0;
    }
    this.x += this.xs;
    if (g.itemWall(this, Math.sign(this.xs))) this.xs = -this.xs;
  } else if (this.kind === "flower" || this.kind === "coin") {
    // 花/金币静态(coin为弹出动画, 由粒子系统处理)
  } else {
    // 蘑菇/1UP: 行走
    this.x += this.xs;
    if (g.itemWall(this, Math.sign(this.xs))) this.xs = -this.xs;
    this.yForce += 0x3d;
    while (this.yForce >= 256) { this.yForce -= 256; this.ys++; }
    if (this.ys > 3) { this.ys = 3; this.yForce = 0; }
    this.py += this.ys;
    if (this.ys > 0 && g.itemFloor(this)) {
      this.py = Math.floor((this.py + 16) / 16) * 16 - 16;
      this.ys = 0; this.yForce = 0;
    }
  }
  if (this.py > 260) this.removed = true;
  if (this.x - g.scrollX < -48) this.removed = true;
};

Item.prototype.draw = function (ctx, scrollX) {
  var g = this.game;
  var sx = Math.round(this.x - scrollX);
  var sy = Math.round(this.py) + 32;
  if (sx < -16 || sx > 260) return;
  if (this.kind === "flower" || this.kind === "star" || this.kind === "mushroom" || this.kind === "oneup") {
    g.drawItemSprite(ctx, this.kind, sx, sy, this.animTimer);
  }
};

// ================= 火球 =================
function Fireball(game, x, py, dir) {
  this.game = game;
  this.x = x; this.py = py;
  this.xs = dir * 4;
  this.ys = 0;
  this.yForce = 0;
  this.bounces = 0;
  this.removed = false;
  this.animTimer = 0;
}

Fireball.prototype.update = function () {
  var g = this.game;
  this.animTimer++;
  this.x += this.xs;
  this.yForce += 0x50;
  while (this.yForce >= 256) { this.yForce -= 256; this.ys++; }
  if (this.ys > 3) this.ys = 3;
  this.py += this.ys;
  if (this.ys > 0 && g.itemFloor(this, 8)) {
    this.py = Math.floor((this.py + 8) / 16) * 16 - 8;
    this.ys = -3; this.yForce = 0;
    this.bounces++;
    if (this.bounces > 2) { this.removed = true; g.spawnPoof(this.x, this.py); }
  }
  // 撞墙
  if (g.fireballWall(this)) {
    this.removed = true;
    g.spawnPoof(this.x, this.py);
    AudioSys.playSfx("sfx_firebounce");
  }
  var sx = this.x - g.scrollX;
  if (sx < -16 || sx > 272 || this.py > 260) this.removed = true;
};

Fireball.prototype.draw = function (ctx, scrollX) {
  var sx = Math.round(this.x - scrollX);
  var sy = Math.round(this.py) + 32;
  var f = MISC_FRAMES["fireball" + (1 + ((this.animTimer >> 2) & 3))];
  ctx.drawImage(this.game.images.player, f.sx, f.sy, f.sw, f.sh, sx - 4, sy - 4, 8, 8);
};

// ================= 粒子 =================
function Particle(game, kind, x, py, xs, ys) {
  this.game = game;
  this.kind = kind; // coin brickBit poof score star
  this.x = x; this.py = py;
  this.xs = xs || 0; this.ys = ys || 0;
  this.life = 0;
  this.removed = false;
  this.text = null;
}

Particle.prototype.update = function () {
  var g = this.game;
  this.life++;
  switch (this.kind) {
    case "coin":
      this.yForce = (this.yForce || 0) + 0x50;
      while (this.yForce >= 256) { this.yForce -= 256; this.ys++; }
      this.py += this.ys;
      if (this.ys >= 5) this.removed = true;
      break;
    case "brickBit":
      this.py += this.ys;
      this.x += this.xs;
      this.ys += 0.3;
      if (this.py > 260) this.removed = true;
      break;
    case "poof":
      if (this.life > 12) this.removed = true;
      break;
    case "score":
      this.py -= 0.8;
      if (this.life > 50) this.removed = true;
      break;
  }
};

Particle.prototype.draw = function (ctx, scrollX) {
  var g = this.game;
  var sx = Math.round(this.x - scrollX);
  var sy = Math.round(this.py) + 32;
  switch (this.kind) {
    case "coin":
      var f = COIN_FRAMES[(this.life >> 2) % 4];
      ctx.drawImage(g.images.tiles, f[0] * 16, f[1] * 16, 16, 16, sx, sy, 16, 16);
      break;
    case "brickBit": {
      var bf = MISC_FRAMES["brickBit" + (1 + ((this.life >> 3) % 4))];
      ctx.drawImage(g.images.player, bf.sx, bf.sy, bf.sw, bf.sh, sx, sy, 8, 8);
      break;
    }
    case "poof":
      ctx.fillStyle = "rgba(255,255,255," + (1 - this.life / 12) + ")";
      ctx.fillRect(sx - 4, sy - 4, 8, 8);
      break;
    case "score":
      drawText(ctx, this.text || "", sx, sy);
      break;
  }
};
