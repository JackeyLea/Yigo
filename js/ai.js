// ai.js — AI 自动闯关机器人
// 规则式 AI: 分析地图/敌人/物品, 自动控制 input 完成关卡
// 按 N 键切换开关, B 键切换调试日志

function AIBot(game) {
  this.game = game;
  this.enabled = false;
  this.debug = false;
  this.jumpHoldFrames = 0;
  this.jumpCooldown = 0;
  this.stuckTimer = 0;
  this.lastX = 0;
  this.lastScrollX = 0;
  this.deathCount = 0;
  this.maxDeaths = 100;
  this.wasDead = false;
  this.levelComplete = false;
  this.testLog = [];
}

AIBot.prototype.toggle = function () {
  this.enabled = !this.enabled;
  if (this.enabled) {
    this.reset();
    this.log("AI 已启用");
  } else {
    this.log("AI 已禁用");
  }
  return this.enabled;
};

AIBot.prototype.reset = function () {
  this.jumpHoldFrames = 0;
  this.jumpCooldown = 0;
  this.stuckTimer = 0;
  this.lastX = 0;
  this.wasDead = false;
  this.levelComplete = false;
};

AIBot.prototype.log = function (msg) {
  if (this.debug) console.log("[AI] " + msg);
  this.testLog.push({ frame: this.game.frame, msg: msg });
  if (this.testLog.length > 100) this.testLog.shift();
};

AIBot.prototype.update = function () {
  if (!this.enabled) return;
  var g = this.game;
  var inp = g.input;

  if (this.jumpCooldown > 0) this.jumpCooldown--;

  switch (g.state) {
    case ST.VERSION_SELECT:
      this.handleVersionSelect(inp);
      break;
    case ST.TITLE:
      this.handleTitle(inp);
      break;
    case ST.INTRO:
      this.handleIntro(inp);
      break;
    case ST.PLAYING:
      this.handlePlaying(inp);
      break;
    case ST.DYING:
      this.handleDying(inp);
      break;
    case ST.FLAG:
    case ST.CASTLE_WALK:
    case ST.TIMECOUNT:
    case ST.LEVEL_END:
      this.handleLevelEnd(inp);
      break;
    case ST.GAMEOVER:
      this.handleGameOver(inp);
      break;
    case ST.PIPE:
      this.clearInput(inp);
      break;
    case ST.WIN:
      this.clearInput(inp);
      break;
  }
};

// ---- 菜单 ----
AIBot.prototype.handleVersionSelect = function (inp) {
  this.clearInput(inp);
  if (this.game.frame % 30 === 0) inp.start = true;
};

AIBot.prototype.handleTitle = function (inp) {
  this.clearInput(inp);
  if (this.game.frame % 20 === 0) inp.start = true;
};

AIBot.prototype.handleIntro = function (inp) {
  this.clearInput(inp);
};

AIBot.prototype.handleDying = function (inp) {
  this.clearInput(inp);
  if (!this.wasDead) {
    this.wasDead = true;
    this.deathCount++;
    this.log("死亡 #" + this.deathCount + " at x=" + Math.round(this.game.player.x));
    if (this.deathCount > this.maxDeaths) {
      this.log("死亡次数过多, AI 停止");
      this.enabled = false;
    }
  }
};

AIBot.prototype.handleGameOver = function (inp) {
  this.clearInput(inp);
  if (this.game.gameOverTimer > 220) inp.start = true;
};

AIBot.prototype.handleLevelEnd = function (inp) {
  this.clearInput(inp);
  inp.right = true;
  inp.run = true;
  this.levelComplete = true;
};

// ---- 游戏主逻辑 ----
AIBot.prototype.handlePlaying = function (inp) {
  var g = this.game;
  var p = g.player;
  var L = g.level;
  if (!L || p.dead) { this.clearInput(inp); return; }

  this.clearInput(inp);

  if (g.paused) { inp.start = true; return; }

  if (this.wasDead) this.wasDead = false;

  this.checkStuck();

  // 基本: 一直向右跑
  inp.right = true;
  inp.run = true;

  var px = p.x;
  var py = p.py;
  var ph = p.height();
  var feetY = py + ph;
  var headY = py;
  var centerX = px + 6;

  var playerCol = Math.floor(centerX / 16);
  var feetRow = Math.floor(feetY / 16);
  var headRow = Math.floor(headY / 16);
  var bodyTopRow = Math.floor((py + 2) / 16);
  var bodyBotRow = Math.floor((feetY - 2) / 16);

  // === 地形分析 ===
  var wallAhead = this.checkWall(p, L, playerCol, bodyTopRow, bodyBotRow);
  var gapInfo = this.checkGap(L, playerCol, feetRow, feetY);
  var stairAhead = this.checkStair(L, playerCol, feetRow);
  var flagDist = this.getFlagDist(p, L);

  // === 敌人分析 ===
  var threat = this.analyzeThreats(p, g.enemies, g.particles);

  // === 决策 ===

  // 旗杆接近 — 直冲
  if (flagDist !== null && flagDist < 120) {
    inp.right = true;
    inp.run = true;
    return;
  }

  // 跳跃决策
  var needJump = false;

  if (wallAhead.blocked && p.onGround && this.jumpCooldown === 0) {
    needJump = true;
    this.log("跳: 墙壁");
  }

  if (gapInfo.hasGap && p.onGround && this.jumpCooldown === 0) {
    needJump = true;
    this.log("跳: 坑洞(" + gapInfo.gapWidth + "宽)");
    if (gapInfo.gapWidth >= 3) inp.run = true;
  }

  if (stairAhead.needJump && p.onGround && this.jumpCooldown === 0) {
    needJump = true;
    this.log("跳: 楼梯");
  }

  if (threat.needJump && p.onGround && this.jumpCooldown === 0) {
    needJump = true;
    this.log("跳: 躲避" + threat.kind);
  }

  // 下落中自救
  if (!p.onGround && p.ys > 0 && gapInfo.falling) {
    inp.right = true;
    inp.run = true;
  }

  if (needJump) {
    inp.jump = true;
    this.jumpHoldFrames = 12;
    this.jumpCooldown = 8;
  }

  if (this.jumpHoldFrames > 0 && !p.onGround) {
    inp.jump = true;
    this.jumpHoldFrames--;
  }

  if (threat.needDuck) {
    inp.down = true;
    inp.right = true;
    inp.jump = false;
    this.jumpHoldFrames = 0;
  }

  if (this.stuckTimer > 45 && p.onGround && this.jumpCooldown === 0) {
    inp.jump = true;
    this.jumpHoldFrames = 14;
    this.jumpCooldown = 15;
    this.stuckTimer = 0;
    this.log("卡住自救跳");
  }

  if (L.areaType === 0 && g.inWater && g.inWater(p)) {
    inp.jump = (g.frame % 40) < 10;
    inp.up = (g.frame % 60) < 30;
  }
};

AIBot.prototype.clearInput = function (inp) {
  inp.left = false;
  inp.right = false;
  inp.up = false;
  inp.down = false;
  inp.jump = false;
  inp.run = false;
  inp.start = false;
};

// 检测前方墙壁/障碍
AIBot.prototype.checkWall = function (p, L, playerCol, topRow, botRow) {
  var result = { blocked: false, col: -1, height: 0, tall: false };

  // 检查前方 1-4 格
  var checkCols = [playerCol + 1, playerCol + 2, playerCol + 3, playerCol + 4];
  for (var ci = 0; ci < checkCols.length; ci++) {
    var col = checkCols[ci];
    var obstacleHeight = 0;

    // 从玩家头顶到脚底检查
    for (var r = topRow; r <= botRow; r++) {
      if (r < 0 || r >= LEVEL_ROWS) continue;
      var mt = L.at(col, r);
      if (isSolidMetatile(mt) && mt !== 0x5f && mt !== 0x60) {
        obstacleHeight++;
      }
    }

    // 也检查上方是否有延伸的障碍（如高水管）
    var checkUp = topRow - 1;
    while (checkUp >= 0) {
      var mtUp = L.at(col, checkUp);
      if (isSolidMetatile(mtUp) && mtUp !== 0x5f && mtUp !== 0x60) {
        obstacleHeight++;
        checkUp--;
      } else {
        break;
      }
    }

    if (obstacleHeight > 0) {
      result.blocked = true;
      result.col = col;
      result.height = obstacleHeight;
      // 高度超过 2 格视为高障碍（如高水管）
      result.tall = obstacleHeight >= 3;
      return result;
    }
  }
  return result;
};

// 检测前方坑洞
AIBot.prototype.checkGap = function (L, playerCol, feetRow, feetY) {
  var result = { hasGap: false, gapWidth: 0, falling: false };

  if (feetRow >= LEVEL_ROWS) {
    result.falling = true;
    result.hasGap = true;
    return result;
  }

  var groundRow = feetRow;
  var gapWidth = 0;
  for (var d = 1; d <= 6; d++) {
    var col = playerCol + d;
    if (col < 0 || col >= L.width) break;
    var mt = L.at(col, groundRow);
    var isGround = isSolidMetatile(mt) && mt !== 0x5f && mt !== 0x60;
    if (!isGround) {
      var mt2 = L.at(col, groundRow + 1);
      var isLower = isSolidMetatile(mt2) && mt2 !== 0x5f && mt2 !== 0x60;
      if (!isLower) {
        gapWidth++;
      } else {
        break;
      }
    } else {
      break;
    }
  }
  result.gapWidth = gapWidth;
  result.hasGap = gapWidth >= 2;
  return result;
};

// 检测楼梯
AIBot.prototype.checkStair = function (L, playerCol, feetRow) {
  var result = { needJump: false };
  var checkCol = playerCol + 1;
  if (checkCol >= L.width) return result;
  var mt = L.at(checkCol, feetRow - 1);
  if (isSolidMetatile(mt) && mt !== 0x5f && mt !== 0x60) {
    var mtBelow = L.at(checkCol, feetRow);
    if (!isSolidMetatile(mtBelow)) {
      result.needJump = true;
    }
  }
  return result;
};

// 检测旗杆距离
AIBot.prototype.getFlagDist = function (p, L) {
  if (!L.flagpole) return null;
  var dist = L.flagpole.x - p.x;
  return dist > 0 ? dist : null;
};

// 分析敌人威胁
AIBot.prototype.analyzeThreats = function (p, enemies, particles) {
  var result = { needJump: false, needDuck: false, kind: null };
  var px = p.x + 6;
  var py = p.py + p.height() / 2;

  for (var i = 0; i < enemies.length; i++) {
    var e = enemies[i];
    if (e.removed || !e.alive || e.noCollide) continue;

    var ex = e.x + e.w / 2;
    var ey = e.py + e.h / 2;
    var dx = ex - px;
    var dy = ey - py;

    if (dx < -10 || dx > 60) continue;
    if (Math.abs(dy) > 40) continue;

    var kind = e.kind;

    if (kind === "piranha" || kind === "podoboo" ||
        kind === "firebarShort" || kind === "firebarMed" ||
        kind === "firebarLong" || kind === "bowserFire" ||
        kind === "spiny") {
      if (dx > 0 && dx < 40 && Math.abs(dy) < 25) {
        result.needDuck = true;
        result.kind = kind;
        return result;
      }
    }

    if (kind === "bowser") {
      if (dx > 0 && dx < 50) {
        result.needJump = true;
        result.kind = kind;
        return result;
      }
    }

    if (kind === "goomba" || kind === "koopa" || kind === "koopaRed" ||
        kind === "buzzy" || kind === "koopaFlyV" || kind === "koopaFlyH" ||
        kind === "hammerBro" || kind === "koopaJump" || kind === "lakitu") {
      if (dx > 0 && dx < 32 && Math.abs(dy) < 16) {
        result.needJump = true;
        result.kind = kind;
        return result;
      }
    }
  }

  if (particles) {
    for (var j = 0; j < particles.length; j++) {
      var pt = particles[j];
      if (pt.removed || pt.kind !== "hammer") continue;
      var hdx = pt.x - px;
      var hdy = pt.py - py;
      if (hdx > 0 && hdx < 40 && Math.abs(hdy) < 20) {
        result.needDuck = true;
        result.kind = "hammer";
        return result;
      }
    }
  }

  return result;
};

// 检测是否卡住
AIBot.prototype.checkStuck = function () {
  var g = this.game;
  var p = g.player;
  if (Math.abs(p.x - this.lastX) < 0.5 && Math.abs(g.scrollX - this.lastScrollX) < 0.5) {
    this.stuckTimer++;
  } else {
    this.stuckTimer = 0;
  }
  this.lastX = p.x;
  this.lastScrollX = g.scrollX;
};

// 获取测试报告
AIBot.prototype.getReport = function () {
  var g = this.game;
  return {
    enabled: this.enabled,
    deaths: this.deathCount,
    levelComplete: this.levelComplete,
    score: g.score,
    coins: g.coins,
    lives: g.lives,
    world: g.worldLabel ? g.worldLabel() : (g.world + 1),
    area: g.area + 1,
    playerX: Math.round(g.player.x),
    playerY: Math.round(g.player.py),
    scrollX: Math.round(g.scrollX),
    state: g.state,
    log: this.testLog.slice(-10),
  };
};
