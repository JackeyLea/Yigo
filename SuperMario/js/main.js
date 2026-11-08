// main.js — 启动/输入/主循环
(function () {
  window.__errs = [];
  window.addEventListener("error", function (ev) {
    window.__errs.push(ev.message + " @" + (ev.filename || "") + ":" + (ev.lineno || 0));
  });
  var canvas = document.getElementById("screen");
  var game = new Game(canvas);
  window.__game = game;
  var aiBot = new AIBot(game);
  window.__ai = aiBot;

  // 尺寸自适应(整数缩放)
  function resize() {
    var scale = Math.max(1, Math.floor(Math.min(window.innerWidth / 256, (window.innerHeight - 60) / 240)));
    canvas.style.width = 256 * scale + "px";
    canvas.style.height = 240 * scale + "px";
  }
  window.addEventListener("resize", resize);
  resize();

  // 输入映射(与原版习惯一致: 方向+A跳+B跑/火)
  var keys = {
    ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down",
    KeyA: "left", KeyD: "right", KeyW: "up", KeyS: "down",
    KeyZ: "jump", Space: "jump", KeyK: "jump",
    KeyX: "run", KeyJ: "run", ShiftLeft: "run", ShiftRight: "run",
    Enter: "start", Escape: "start",
  };
  window.addEventListener("keydown", function (ev) {
    if (ev.code === "KeyM") {
      AudioSys.enabled = !AudioSys.enabled;
      if (!AudioSys.enabled) AudioSys.stopMusic();
      else game.playAreaMusic && game.level && game.playAreaMusic();
      ev.preventDefault();
      return;
    }
    if (ev.code === "KeyN") {
      aiBot.toggle();
      ev.preventDefault();
      return;
    }
    if (ev.code === "KeyB") {
      aiBot.debug = !aiBot.debug;
      console.log("[AI] Debug mode: " + aiBot.debug);
      ev.preventDefault();
      return;
    }
    var k = keys[ev.code];
    if (k) {
      game.input[k] = true;
      AudioSys.unlock();
      ev.preventDefault();
    }
  });
  window.addEventListener("keyup", function (ev) {
    var k = keys[ev.code];
    if (k) { game.input[k] = false; ev.preventDefault(); }
  });

  // 资源加载
  game.loadImages(function () {
    AudioSys.loadAll(null, function (failed) {
      if (failed) console.warn("audio files failed:", failed);
    });

    // ---- 测试模式: ?t=1&w=世界&a=关卡&f=帧数&in=输入脚本&x=初始x ----
    var q = new URLSearchParams(location.search);
    if (q.get("v") === "ll") {
      if (typeof DATASETS === "undefined" || !DATASETS.smb2j) {
        var c0 = canvas.getContext("2d");
        c0.fillStyle = "#f00"; c0.fillRect(0, 0, 256, 240);
        drawText(c0, "NO DATASETS", 60, 100);
        return;
      }
      game.version = "smb2j"; game.ds = DATASETS.smb2j;
      if (typeof game.ds.LEVEL_DATA === "undefined" || Object.keys(game.ds.LEVEL_DATA).length === 0) {
        var c1 = canvas.getContext("2d");
        c1.fillStyle = "#00f"; c1.fillRect(0, 0, 256, 240);
        return;
      }
      if (!game.ds.art || Object.keys(game.ds.art).length === 0) {
        var c2 = canvas.getContext("2d");
        c2.fillStyle = "#0f0"; c2.fillRect(0, 0, 256, 240);
        return;
      }
    }
    if (q.get("t")) {
      game.world = +(q.get("w") || 0);
      game.area = +(q.get("a") || 0);
      game.lives = 3;
      var script = q.get("in") || "";
      game.loadArea(game.world, game.area, {});
      if (q.get("x")) { game.player.x = +q.get("x"); game.scrollX = Math.max(0, game.player.x - 80); }
      var frames = +(q.get("f") || 300);
      var err = null;
      var trail = [];
      // 定时事件: in=rj;j@120;j@200 → 在指定帧按跳(15帧)
      var jumps = [];
      var base = script.replace(/j@(\d+)/g, function (m, n) { jumps.push(+n); return ""; });
      if (q.get("big")) game.player.status = 1;
      game.applyPhysics();
      if (q.get("fire")) game.player.status = 2;
      for (var i = 0; i < frames; i++) {
        // 脚本: r=右 l=左 j=跳(周期) s=跑 u=上 d=下
        game.input.right = base.indexOf("r") >= 0;
        game.input.left = base.indexOf("l") >= 0;
        game.input.run = base.indexOf("s") >= 0;
        game.input.down = base.indexOf("d") >= 0;
        var timedJump = false;
        for (var ji = 0; ji < jumps.length; ji++) {
          if (i >= jumps[ji] && i < jumps[ji] + 15) timedJump = true;
        }
        game.input.jump = (base.indexOf("j") >= 0 && (i % 40) < 20) || timedJump;
        try { game.update(); } catch (e) { err = e.message + " @" + (e.stack || "").split("\n")[1]; break; }
        if (i % 40 === 0) trail.push(i + ":" + Math.round(game.player.py) + "/" + Math.round(game.player.x) + (game.player.onGround ? "G" : "g"));
      }
      try { game.render(); } catch (e) { err = "render: " + e.message; }
      var p = game.player;
      var info = "T " + game.worldLabel() + "-" + (game.area+1) + " s=" + game.state + (game.level.wind ? " WIND" : "") + " x=" + Math.round(p.x) + " y=" + Math.round(p.py) +
        " sc=" + Math.round(game.scrollX) + " t=" + game.time + " st=" + p.status +
        " en=" + game.enemies.length + " g=" + p.onGround + " E:" + err;
      var ed = [];
      for (var ei = 0; ei < game.enemies.length && ei < 4; ei++) {
        var e = game.enemies[ei];
        ed.push(e.kind.charAt(0) + Math.round(e.x) + "/" + Math.round(e.py) + (e.alive ? "" : "X"));
      }
      document.title = info;
      drawText(game.ctx, info.substring(0, 60), 4, 226);
      drawText(game.ctx, ("EN: " + ed.join(" ")).substring(0, 58), 4, 218);
      drawText(game.ctx, trail.join(" ").substring(0, 58), 4, 234);
      return; // 不进入正常循环
    }

    // 固定 60fps 步进(setInterval 驱动, 不受标签页 rAF 节流影响)
    var acc = 0, last = performance.now();
    function tick() {
      var now = performance.now();
      acc += now - last;
      last = now;
      var steps = 0;
      while (acc >= 1000 / 60 && steps < 6) {
        try {
          // AI 自动更新 input
          aiBot.update();
          game.update();
        } catch (e) {
          window.__errs.push("update: " + e.message + " " + (e.stack || "").split("\n")[1]);
          acc = 0; break;
        }
        acc -= 1000 / 60;
        steps++;
      }
      if (steps === 6) acc = 0;
      try {
        game.render();
        // AI 状态显示
        if (aiBot.enabled) {
          var ctx = game.ctx;
          ctx.fillStyle = "rgba(0,0,0,0.6)";
          ctx.fillRect(0, 0, 256, 12);
          ctx.fillStyle = "#0f0";
          var report = aiBot.getReport();
          var status = "AI W" + report.world + "-" + report.area + " S:" + report.score + " D:" + report.deaths;
          drawText(ctx, status, 4, 2);
        }
      } catch (e) {
        window.__errs.push("render: " + e.message + " " + (e.stack || "").split("\n")[1]);
        window.__errs.push("STOPPED");
      }
      if (window.__errs.some(function (x) { return x === "STOPPED"; })) {
        clearInterval(handle);
      }
    }
    var handle = setInterval(tick, 4);
  });
})();
