// player.js — 马里奥: 原版物理(4.4水平/8.8垂直定点)+ 状态机
// 常量来自 smbdis 反汇编(见 SuperMarioBros-C 分析)

// X 速度为 4.4 定点(单位 = 1/16 px/帧), XS 为整数像素速度, force 为小数累加
function Player(game) {
  this.game = game;
  this.reset();
}

Player.prototype.reset = function () {
  this.x = 40; this.y = 0;            // 世界像素 / 屏幕像素(含HUD偏移, 用 playY)
  this.py = this.y;                   // playfield y (0=玩法区顶)
  this.xs = 0;                        // X速度 px/帧(有符号)
  this.xForce = 0;                    // 4.4 小数累加 (0-15→px)
  this.ys = 0;                        // Y速度 px/帧(有符号)
  this.yForce = 0;                    // 8.8 小数累加 (256进制)
  this.dir = 1;                       // 朝向
  this.status = 0;                    // 0小 1大 2火
  this.state = 0;                     // 0地面 1跳 2落 3藤
  this.onGround = false;
  this.running = false;
  this.skidding = false;
  this.animTimer = 0;
  this.animFrame = 0;
  this.crouch = false;
  this.swimTimer = 0;
  this.starTimer = 0;                 // 间隔单位(21帧)
  this.injuryBlink = 0;               // 受伤闪烁帧
  this.growTimer = 0;                 // 变身冻结
  this.growDir = 0;                   // 1变大 -1变小
  this.fireFlash = 0;                 // 变火焰调色闪烁
  this.dead = false;
  this.deadTimer = 0;
  this.frozen = 0;                    // 全局冻结帧(变身等)
  this.jumpHeld = false;
  this.vine = null;
  this.fireballs = 0;
  this.poleSlide = false;
  this.warpAnim = null;               // 进管动画
  this.shooting = 0;                  // 发射动画
  this.kickTimer = 0;
  this.swimKickCooldown = 0;
};

Player.prototype.width = function () { return this.status === 0 ? 12 : 12; };
Player.prototype.height = function () { return this.status === 0 ? 16 : 30; };

// ---- 输入驱动的水平物理(原版 X_Physics) ----
Player.prototype.updateHorizontal = function (input) {
  var g = this.game;
  var left = input.left && !this.dead && this.frozen <= 0 && !this.poleSlide;
  var right = input.right && !this.dead && this.frozen <= 0 && !this.poleSlide;
  var run = input.run;
  var inWater = g.level && g.level.areaType === 0 && g.inWater(this);

  if (inWater) { this.updateSwim(input); return; }

  this.running = run && (left || right) && this.onGround ? true :
    (run && !this.onGround && this.running ? true : (this.onGround ? false : this.running));

  var maxSpeed, accel;
  if (this.onGround) {
    if (run && (left || right)) {
      maxSpeed = 0x28; accel = 0xe4;      // 跑
    } else {
      maxSpeed = 0x18; accel = 0x98;      // 走
    }
  } else {
    maxSpeed = 0x10; accel = 0x98;        // 空中(转向/慢)
    if (Math.abs(this.xs) > 1.0) { maxSpeed = this.running ? 0x28 : 0x18; accel = 0xe4; }
  }

  var moving = left !== right;
  this.skidding = false;
  if (moving && this.frozen <= 0) {
    var want = right ? 1 : -1;
    if (this.onGround && this.xs !== 0 && want !== Math.sign(this.xs)) {
      // 打滑: 摩擦×2
      this.skidding = true;
      accel = 0x98 * 2;
      this.applyAccel(want, accel, 0x10);
      if (Math.abs(this.xs) < 0.7 && Math.abs(this.xForce) < 0x0b0) {
        this.xs = 0; this.xForce = 0;
      }
    } else {
      this.applyAccel(want, accel, maxSpeed);
      this.dir = want;
    }
  } else if (this.onGround) {
    // 松手摩擦
    this.applyFriction(0xd0);
  }
};

Player.prototype.applyAccel = function (dir, accel256, maxSpeed) {
  // accel256: 256分制加速度(每帧加到 force)
  this.xForce += accel256;
  while (this.xForce >= 256) {
    this.xForce -= 256;
    this.xs += dir;
  }
  if (dir > 0 && this.xs * 16 + (this.xForce >> 4) > maxSpeed) {
    this.xs = maxSpeed >> 4; this.xForce = (maxSpeed & 0x0f) << 4;
    if (this.xForce & 0xf0 && false) {}
  }
  if (dir < 0 && this.xs * 16 + (this.xForce >> 4) < -maxSpeed) {
    this.xs = -((maxSpeed >> 4)); this.xForce = -((maxSpeed & 0x0f) << 4);
  }
  // 简化限幅(与上等价)
  var cap = maxSpeed / 16;
  if (this.xs > cap) { this.xs = cap; }
  if (this.xs < -cap) { this.xs = -cap; }
};

Player.prototype.applyFriction = function (fric256) {
  this.xForce -= fric256;
  if (this.xForce < 0 && this.xs > 0) { this.xs--; this.xForce += 256; }
  else if (this.xForce < 0) {
    if (this.xs < 0) { this.xs++; this.xForce += 256; }
    else this.xForce = 0;
  }
  if (this.xs === 0) this.xForce = 0;
};

// ---- 跳跃(原版 InitJS / JumpSwimSub) ----
Player.prototype.jumpInit = function () {
  var spd = Math.abs(this.xs * 16 + (this.xForce >> 4));
  var idx;
  if (spd < 0x09) idx = 0;
  else if (spd < 0x10) idx = 1;
  else if (spd < 0x19) idx = 2;
  else if (spd < 0x1c) idx = 3;
  else idx = 4;
  var initY = [ -4, -4, -4, -5, -5 ][idx];
  this.ys = initY;
  this.yForce = 0;
  this.state = 1;
  this.onGround = false;
  this.jumpIdx = idx;
  this.game.stats.jumpCount++;
  AudioSys.playSfx(this.status === 0 ? "sfx_jump_small" : "sfx_jump_big");
};

Player.prototype.risingGravity = function () {
  return [0x20, 0x20, 0x1e, 0x28, 0x28][this.jumpIdx || 0];
};
Player.prototype.fallingGravity = function () {
  return [0x70, 0x70, 0x60, 0x90, 0x90][this.jumpIdx || 0];
};

Player.prototype.updateVertical = function (input, prevA) {
  var g = this.game;
  var inWater = g.level && g.level.areaType === 0 && g.inWater(this);
  if (inWater) return; // 游泳单独处理

  if (this.ys < 0) {
    // 上升: 按住A用低重力
    var grav = (input.jump && this.jumpHeld) ? this.risingGravity() : this.fallingGravity();
    this.yForce += grav;
    while (this.yForce >= 256) { this.yForce -= 256; this.ys++; }
    if (this.ys >= 0) { this.ys = 0; this.state = 2; }
  } else {
    // 下落
    this.yForce += this.fallingGravity();
    while (this.yForce >= 256) { this.yForce -= 256; this.ys++; }
    if (this.ys > 4) { this.ys = 4; this.yForce = 0; }
    this.state = 2;
  }
};

// ---- 游泳 ----
Player.prototype.updateSwim = function (input) {
  var g = this.game;
  // 水平: 慢速
  var left = input.left, right = input.right;
  if (left !== right) {
    var want = right ? 1 : -1;
    this.xForce += 0x98;
    while (this.xForce >= 256) { this.xForce -= 256; this.xs += want; }
    if (this.xs > 1.0) this.xs = 1.0;
    if (this.xs < -1.0) this.xs = -1.0;
    this.dir = want;
  } else {
    this.applyFriction(0xd0);
  }
  // 蹬水跳
  if (input.jump && !this.jumpHeld && this.swimKickCooldown <= 0) {
    this.ys = -2; this.yForce = 0x80;
    this.swimKickCooldown = 12;
    AudioSys.playSfx("sfx_swim");
    this.state = 1;
  }
  if (this.swimKickCooldown > 0) this.swimKickCooldown--;
  // 浮力重力
  var grav;
  if (this.ys < 0) grav = 0x0d; else grav = 0x0a;
  this.yForce += grav;
  while (this.yForce >= 256) { this.yForce -= 256; this.ys++; }
  if (this.ys > 2) { this.ys = 2; this.yForce = 0; }
  if (this.ys >= 0) this.state = 2;
};

// ---- 更新入口 ----
Player.prototype.update = function (input, prevInput) {
  var g = this.game;

  if (this.starTimer > 0) {
    this.starTimer--;
    if (this.starTimer === 0) g.onStarEnd();
  }
  if (this.injuryBlink > 0) this.injuryBlink--;
  if (this.shooting > 0) this.shooting--;
  if (this.frozen > 0) { this.frozen--; this.handleGrow(); return; }
  if (this.kickTimer > 0) this.kickTimer--;

  var inWater = g.level && g.level.areaType === 0 && g.inWater(this);

  // 死亡动画
  if (this.dead) {
    this.deadTimer++;
    if (this.deadTimer === 30) { this.ys = -4; }
    if (this.deadTimer > 30) {
      this.yForce += 0x40;
      while (this.yForce >= 256) { this.yForce -= 256; this.ys++; }
      if (this.ys > 4) this.ys = 4;
      this.py += this.ys;
    }
    if (this.deadTimer > 200) g.afterDeath();
    return;
  }

  // 旗杆滑行
  if (this.poleSlide) { this.updatePoleSlide(); return; }

  // 藤蔓
  if (this.state === 3 && this.vine) { this.updateVine(input); return; }

  this.updateHorizontal(input);
  this.updateVertical(input, prevInput.jump);

  // 跳跃触发
  if (input.jump && !prevInput.jump && this.onGround && !inWater && this.frozen <= 0) {
    this.jumpInit();
  }
  this.jumpHeld = input.jump;

  // 发火球
  if (input.run && !prevInput.run && this.status === 2 && this.fireballs < 2 && !this.crouch) {
    g.spawnFireball();
    this.fireballs++;
    this.shooting = 8;
    AudioSys.playSfx("sfx_fireball");
  }

  // 移动与碰撞
  this.moveX();
  this.moveY();

  // 蹲下(大马里奥)
  this.crouch = this.status > 0 && input.down && this.onGround && !inWater;
};

// 水平移动与墙体碰撞
Player.prototype.moveX = function () {
  var g = this.game;
  var dx = this.xs;
  if (dx === 0) return;
  var steps = Math.abs(dx);
  var stepDir = Math.sign(dx);
  for (var i = 0; i < steps; i++) {
    this.x += stepDir;
    var frac = this.xForce & 0x0f;
    if (g.collideWall(this, stepDir)) {
      this.x -= stepDir;
      this.xs = 0; this.xForce = 0;
      return;
    }
  }
};

// 垂直移动与地面/天花板
Player.prototype.moveY = function () {
  var g = this.game;
  var dy = this.ys;
  if (dy === 0) { this.checkGround(); return; }
  var steps = Math.abs(dy);
  var stepDir = Math.sign(dy);
  for (var i = 0; i < steps; i++) {
    this.py += stepDir;
    if (stepDir > 0) {
      // 下落: 着地检测
      if (g.collideFloor(this)) {
        this.py = Math.floor((this.py + this.height()) / 16) * 16 - this.height();
        if (!this.onGround) g.onLand();
        this.onGround = true;
        this.ys = 0; this.yForce = 0;
        this.state = 0;
        return;
      }
      this.onGround = false;
    } else {
      // 上升: 顶头
      if (g.collideCeil(this)) {
        this.py = Math.floor(this.py / 16) * 16 + 16;
        this.ys = 0; this.yForce = 0;
        this.state = 2;
        g.bonkBlock(this);
        return;
      }
    }
  }
  this.checkGround();
};

Player.prototype.checkGround = function () {
  var g = this.game;
  if (g.collideFloor(this)) {
    this.py = Math.floor((this.py + this.height()) / 16) * 16 - this.height();
    if (!this.onGround) g.onLand();
    this.onGround = true;
    if (this.ys > 0) { this.ys = 0; this.yForce = 0; }
    if (this.state === 2) this.state = 0;
  } else {
    if (this.onGround && this.ys === 0) {
      // 走出平台
      this.onGround = false;
      this.state = 2;
      this.jumpIdx = 0;
    }
  }
};

// ---- 变身 ----
Player.prototype.grow = function () {
  if (this.status === 0) {
    this.growTimer = 60; this.growDir = 1; this.frozen = 60;
    AudioSys.playSfx("sfx_powerup");
  } else {
    this.fireFlash = 64; this.frozen = 40;
    this.status = 2;
    AudioSys.playSfx("sfx_powerup");
  }
};
Player.prototype.handleGrow = function () {
  if (this.growTimer > 0) {
    this.growTimer--;
    if (this.growTimer === 0xF8 / 4) {} // 占位
    if (this.growTimer === 28) {
      this.status = Math.min(1, this.status + 1);
    }
  }
  if (this.fireFlash > 0) this.fireFlash--;
};

Player.prototype.shrink = function () {
  if (this.status > 0) {
    this.status = 0;
    this.growTimer = 60; this.growDir = -1; this.frozen = 45;
    this.injuryBlink = 168;
    AudioSys.playSfx("sfx_pipe");
  } else {
    this.die();
  }
};

Player.prototype.die = function () {
  if (this.dead) return;
  this.dead = true;
  this.deadTimer = 0;
  this.ys = 0; this.yForce = 0;
  AudioSys.stopMusic();
  AudioSys.playSfx("sfx_1up"); // 占位, 由 game 播放死亡音乐
};

// ---- 旗杆 ----
Player.prototype.startPoleSlide = function (poleX) {
  this.poleSlide = true;
  this.x = poleX - 12; // 贴杆左侧
  this.ys = 0;
  this.state = 0;
};
Player.prototype.updatePoleSlide = function () {
  var g = this.game;
  this.py += 2;
  if (this.py >= 176) { // 滑到底(行11顶部)
    g.poleBottomReached();
  }
};

// ---- 藤蔓 ----
Player.prototype.updateVine = function (input) {
  var g = this.game;
  var up = input.up, down = input.down;
  if (up !== down) {
    this.py += up ? -1 : 1;
    if ((g.frame & 3) === 0) this.animFrame = (this.animFrame + 1) % 2;
  }
  if (this.py < 32) this.py = 32;
  // 顶部出屏或按跳离开
  if (input.jump && !this.jumpHeld) {
    this.state = 2; this.vine = null; this.onGround = false;
    this.jumpIdx = 0; this.ys = 0;
  }
  this.jumpHeld = input.jump;
  if (this.py <= 40 && !up) { /* 停在顶 */ }
};

// ---- 动画帧选择 ----
Player.prototype.pose = function () {
  if (this.dead) return "death";
  if (this.state === 3) return this.animFrame ? "climb2" : "climb1";
  var g = this.game;
  var inWater = g.level && g.level.areaType === 0 && g.inWater(this);
  if (inWater && !this.onGround) {
    return ["swim1", "swim2", "swim3"][this.animFrame % 3];
  }
  if (this.crouch) return "crouch";
  if (!this.onGround) return "jump";
  if (this.skidding && this.xs !== 0) return "skid";
  if (this.xs !== 0) {
    return "walk" + (this.animFrame + 1);
  }
  return "idle";
};

Player.prototype.updateAnim = function () {
  if (this.xs !== 0 && this.onGround) {
    var speed = Math.abs(this.xs);
    var interval = speed >= 2 ? 2 : (speed >= 1 ? 4 : 7);
    this.animTimer++;
    if (this.animTimer >= interval) {
      this.animTimer = 0;
      this.animFrame = (this.animFrame + 1) % 3;
    }
  } else if (this.game.level && this.game.level.areaType === 0 && this.game.inWater(this)) {
    this.animTimer++;
    if (this.animTimer >= 8) { this.animTimer = 0; this.animFrame = (this.animFrame + 1) % 3; }
  } else {
    this.animTimer = 0; this.animFrame = 0;
  }
};
