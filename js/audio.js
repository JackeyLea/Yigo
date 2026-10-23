// audio.js — WebAudio 音乐/音效管理(资源为本地原声文件)
var AudioSys = {
  ctx: null,
  buffers: {},
  musicGain: null,
  sfxGain: null,
  currentMusic: null,
  currentSource: null,
  enabled: true,
  musicEnabled: true,
  _unlockDone: false,

  files: {
    // 音乐
    "music_overworld": "assets/audio/music_overworld.mp3",
    "music_overworld_fast": "assets/audio/music_overworld_fast.mp3",
    "music_underground": "assets/audio/music_underground.wav",
    "music_underground_fast": "assets/audio/music_underground.wav",
    "music_underwater": "assets/audio/music_underwater.mp3",
    "music_underwater_fast": "assets/audio/music_underwater_fast.mp3",
    "music_castle": "assets/audio/music_castle.mp3",
    "music_castle_fast": "assets/audio/music_castle_fast.mp3",
    "music_star": "assets/audio/music_star.mp3",
    // 过场音乐
    "jingle_death": "assets/audio/jingle_death.mp3",
    "jingle_gameover": "assets/audio/jingle_gameover.mp3",
    "jingle_stageclear": "assets/audio/jingle_stageclear.mp3",
    "jingle_castle": "assets/audio/jingle_castle.mp3",
    "jingle_flagpole": "assets/audio/jingle_flagpole.mp3",
    "jingle_worldclear": "assets/audio/jingle_worldclear.mp3",
    "jingle_hurry": "assets/audio/jingle_hurry.mp3",
    "jingle_timecount": "assets/audio/jingle_timecount.mp3",
    "jingle_bowserfall": "assets/audio/jingle_bowserfall.mp3",
    "jingle_bridgebreak": "assets/audio/jingle_bridgebreak.mp3",
    // 音效
    "sfx_jump_small": "assets/audio/sfx_jump_small.mp3",
    "sfx_jump_big": "assets/audio/sfx_jump_big.mp3",
    "sfx_stomp": "assets/audio/sfx_stomp.wav",
    "sfx_coin": "assets/audio/sfx_coin.wav",
    "sfx_break": "assets/audio/sfx_break.wav",
    "sfx_bump": "assets/audio/sfx_bump.mp3",
    "sfx_itemappear": "assets/audio/sfx_itemappear.mp3",
    "sfx_powerup": "assets/audio/sfx_powerup.mp3",
    "sfx_1up": "assets/audio/sfx_1up.mp3",
    "sfx_fireball": "assets/audio/sfx_fireball.mp3",
    "sfx_kick": "assets/audio/sfx_kick.mp3",
    "sfx_pipe": "assets/audio/sfx_pipe.mp3",
    "sfx_swim": "assets/audio/sfx_swim.mp3",
    "sfx_bullet": "assets/audio/sfx_bullet.mp3",
  },

  init: function () {
    if (this.ctx) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.55;
    this.musicGain.connect(this.ctx.destination);
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 0.9;
    this.sfxGain.connect(this.ctx.destination);
  },

  unlock: function () {
    this.init();
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
  },

  loadAll: function (onProgress, onDone) {
    this.init();
    var keys = Object.keys(this.files);
    var loaded = 0, failed = 0;
    var self = this;
    keys.forEach(function (key) {
      var url = self.files[key];
      fetch(url).then(function (r) {
        if (!r.ok) throw new Error("http " + r.status);
        return r.arrayBuffer();
      }).then(function (ab) {
        return self.ctx.decodeAudioData(ab);
      }).then(function (buf) {
        self.buffers[key] = buf;
      }).catch(function () {
        failed++;
      }).then(function () {
        loaded++;
        if (onProgress) onProgress(loaded, keys.length);
        if (loaded === keys.length && onDone) onDone(failed);
      });
    });
  },

  playSfx: function (name) {
    if (!this.enabled || !this.ctx) return;
    var buf = this.buffers[name];
    if (!buf) return;
    var src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.sfxGain);
    src.start();
  },

  // music: 名称; opts: {loop(默认true), speed}
  playMusic: function (name, opts) {
    if (!this.ctx || !this.musicEnabled) return;
    opts = opts || {};
    if (this.currentMusic === name && this.currentSource) return;
    this.stopMusic();
    var buf = this.buffers[name];
    if (!buf) return;
    var src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = opts.loop !== false;
    if (opts.speed) src.playbackRate.value = opts.speed;
    src.connect(this.musicGain);
    src.start();
    this.currentSource = src;
    this.currentMusic = name;
  },

  stopMusic: function () {
    if (this.currentSource) {
      try { this.currentSource.stop(); } catch (e) {}
      this.currentSource = null;
    }
    this.currentMusic = null;
  },
};
