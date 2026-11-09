// Mengambil data global dari songs.js
const notes = window.notes || [];
const songs = window.songs || [];

// ─── CONFIG & CONSTANTS ──────────────────────────────────────────────────────
const BASE_TOPIC = 'muhayara/angklung/ch';
const IS_HTTPS = window.location.protocol === 'https:';
const BROKER_URL = 'wss://broker.rakitai.id/mqtt';
const NOTE_FREQS = [261.63, 293.66, 329.63, 349.23, 392.00, 440.00, 493.88, 523.25];

// ─── STATE MANAGEMENT ────────────────────────────────────────────────────────
let activeSong = -1;
let isPlaying = false;
let seqTimer = null;
let noteOffTimer = null;
let seqIdx = 0;
let connected = false;

const relayState = new Array(8).fill(false);
const activeNodes = new Array(8).fill(null);
let audioCtx = null;
let mqttClient = null;

// ─── DOM ELEMENTS ────────────────────────────────────────────────────────────
const dom = {
  songList: document.getElementById('songList'),
  noteGrid: document.getElementById('noteGrid'),
  relayGrid: document.getElementById('relayGrid'),
  vizBars: document.getElementById('vizBars'),
  connDot: document.getElementById('connDot'),
  connLabel: document.getElementById('connLabel'),
  statConn: document.getElementById('statConn'),
  statMotor: document.getElementById('statMotor'),
  npTitle: document.getElementById('npTitle'),
  progressTrack: document.getElementById('progressTrack'),
  progressFill: document.getElementById('progressFill'),
  timeCur: document.getElementById('timeCur'),
  timeTotal: document.getElementById('timeTotal'),
  playBtn: document.getElementById('playBtn'),
  btnPrev: document.getElementById('btnPrev'),
  btnNext: document.getElementById('btnNext'),
  btnStop: document.getElementById('btnStop'),
  tempoSlider: document.getElementById('tempoSlider'),
  tempoVal: document.getElementById('tempoVal'),
  clock: document.getElementById('clock'),
  muhayaraText: document.getElementById('muhayara-text'),
  themeToggle: document.getElementById('themeToggle')
};

// ─── INIT APPLICATION ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  initUI();
  initMQTT();
  initEvents();
  initCanvasWave();
  initAnimations();
  startClock();
});

// ─── THEME SWITCHER ────────────────────────────────────────────────────────
function initTheme() {
  const savedTheme = localStorage.getItem('theme') || 'light';
  document.body.setAttribute('data-theme', savedTheme);
  if (dom.themeToggle) dom.themeToggle.textContent = savedTheme === 'dark' ? '☀️' : '🌙';

  dom.themeToggle?.addEventListener('click', () => {
    const currentTheme = document.body.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.body.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    if (dom.themeToggle) dom.themeToggle.textContent = newTheme === 'dark' ? '☀️' : '🌙';
  });
}

// ─── UI INITIALIZATION ─────────────────────────────────────────────────────
function initUI() {
  if (dom.songList) {
    dom.songList.innerHTML = '';
    songs.forEach((s, i) => {
      const el = document.createElement('div');
      el.className = 'song-item';
      el.id = `song-${i}`;
      el.innerHTML = `
        <div class="song-num">${String(i + 1).padStart(2, '0')}</div>
        <div class="song-info">
          <div class="song-title">${s.title}</div>
          <div class="song-meta">${s.meta || ''}</div>
        </div>
      `;
      el.addEventListener('click', () => selectSong(i));
      dom.songList.appendChild(el);
    });
  }

  if (dom.noteGrid) {
    dom.noteGrid.innerHTML = '';
    notes.forEach((n, i) => {
      const btn = document.createElement('button');
      btn.className = 'note-btn';
      btn.id = `note-${i}`;
      btn.innerHTML = `${n}<span>CH${i + 1}</span>`;

      btn.addEventListener('mousedown', () => fireRelay(i, true));
      btn.addEventListener('mouseup', () => fireRelay(i, false));
      btn.addEventListener('mouseleave', () => fireRelay(i, false));

      btn.addEventListener('touchstart', (e) => { e.preventDefault(); fireRelay(i, true); });
      btn.addEventListener('touchend', (e) => { e.preventDefault(); fireRelay(i, false); });

      dom.noteGrid.appendChild(btn);
    });
  }

  if (dom.relayGrid) {
    dom.relayGrid.innerHTML = '';
    notes.forEach((n, i) => {
      const ch = document.createElement('div');
      ch.className = 'relay-ch';
      ch.id = `relay-${i}`;
      ch.innerHTML = `
        <div class="relay-led" id="led-${i}"></div>
        <div class="relay-note">${n}</div>
        <div class="relay-idx">CH ${i + 1}</div>
      `;
      dom.relayGrid.appendChild(ch);
    });
  }

  if (dom.vizBars) {
    dom.vizBars.innerHTML = '';
    notes.forEach((n, i) => {
      const wrap = document.createElement('div');
      wrap.className = 'viz-bar-wrap';
      wrap.innerHTML = `
        <div class="viz-bar-container">
          <div class="viz-bar" id="bar-${i}" style="height:4px"></div>
        </div>
        <div class="viz-bar-label">${n}</div>
      `;
      dom.vizBars.appendChild(wrap);
    });
  }
}

// ─── MQTT CLIENT ────────────────────────────────────────────────────────────
function initMQTT() {
  if (typeof mqtt === 'undefined') {
    if (dom.connLabel) dom.connLabel.textContent = 'LIBRARY MISSING';
    return;
  }

  try {
    const clientId = 'angklung_web_' + Math.random().toString(36).substring(2, 7);
    mqttClient = mqtt.connect(BROKER_URL, {
      clientId: clientId,
      connectTimeout: 5000,
      reconnectPeriod: 2000,
      clean: true
    });

    mqttClient.on('connect', () => {
      connected = true;
      if (dom.connDot) dom.connDot.className = 'conn-dot';
      if (dom.connLabel) dom.connLabel.textContent = 'CONNECTED';
      if (dom.statConn) {
        dom.statConn.textContent = 'ONLINE';
        dom.statConn.className = 'metric-value green';
      }
    });

    mqttClient.on('reconnect', () => {
      connected = false;
      if (dom.connDot) dom.connDot.className = 'conn-dot off';
      if (dom.connLabel) dom.connLabel.textContent = 'CONNECTING...';
      if (dom.statConn) {
        dom.statConn.textContent = 'KONEK...';
        dom.statConn.className = 'metric-value orange';
      }
    });

    mqttClient.on('offline', () => {
      connected = false;
      if (dom.connDot) dom.connDot.className = 'conn-dot off';
      if (dom.connLabel) dom.connLabel.textContent = 'DISCONNECTED';
      if (dom.statConn) {
        dom.statConn.textContent = 'OFFLINE';
        dom.statConn.className = 'metric-value orange';
      }
    });

    mqttClient.on('error', (err) => {
      console.error('MQTT Error:', err);
      connected = false;
      if (dom.connDot) dom.connDot.className = 'conn-dot off';
      if (dom.connLabel) dom.connLabel.textContent = 'ERROR';
      if (dom.statConn) {
        dom.statConn.textContent = 'ERROR';
        dom.statConn.className = 'metric-value orange';
      }
    });
  } catch (err) {
    console.error('MQTT Setup error:', err);
  }
}

// ─── AUDIO WAVE VISUALIZER ─────────────────────────────────────────────────
let canvas, ctx, wavePhase = 0;

function initCanvasWave() {
  canvas = document.getElementById('waveCanvas');
  if (!canvas) return;
  ctx = canvas.getContext('2d');

  function resize() {
    if (canvas && canvas.parentElement) {
      canvas.width = canvas.parentElement.clientWidth;
      canvas.height = canvas.parentElement.clientHeight;
    }
  }
  resize();
  window.addEventListener('resize', resize);
  requestAnimationFrame(drawWave);
}

function drawWave() {
  if (!ctx || !canvas) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const isAnyActive = relayState.some(Boolean);
  const targetAmplitude = isAnyActive ? 30 : (isPlaying ? 12 : 3);
  const frequency = isAnyActive ? 0.04 : 0.02;
  const speed = isAnyActive ? 0.15 : 0.04;

  wavePhase += speed;

  ctx.beginPath();
  ctx.lineWidth = 3;
  ctx.strokeStyle = isAnyActive ? '#10b981' : '#3b82f6';

  const centerY = canvas.height / 2;

  for (let x = 0; x < canvas.width; x++) {
    const y = centerY + Math.sin(x * frequency + wavePhase) * targetAmplitude;
    x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();

  ctx.lineTo(canvas.width, canvas.height);
  ctx.lineTo(0, canvas.height);
  ctx.closePath();

  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, isAnyActive ? 'rgba(16, 185, 129, 0.25)' : 'rgba(59, 130, 246, 0.15)');
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = gradient;
  ctx.fill();

  requestAnimationFrame(drawWave);
}

// ─── RELAY & AUDIO CONTROLS ────────────────────────────────────────────────
function initAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function startWebSound(ch) {
  initAudio();
  if (!audioCtx || ch < 0 || ch > 7) return;
  stopWebSound(ch);

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = 'triangle';
  osc.frequency.setValueAtTime(NOTE_FREQS[ch], audioCtx.currentTime);
  gain.gain.setValueAtTime(0.3, audioCtx.currentTime);

  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();

  activeNodes[ch] = { osc, gain };
}

function stopWebSound(ch) {
  if (!audioCtx || !activeNodes[ch]) return;
  const { osc, gain } = activeNodes[ch];
  const now = audioCtx.currentTime;

  gain.gain.setValueAtTime(gain.gain.value, now);
  gain.gain.linearRampToValueAtTime(0.001, now + 0.05);
  osc.stop(now + 0.05);
  activeNodes[ch] = null;
}

function fireRelay(ch, on) {
  if (ch < 0 || ch > 7) return;
  relayState[ch] = on;

  on ? startWebSound(ch) : stopWebSound(ch);

  if (connected && mqttClient) {
    mqttClient.publish(`${BASE_TOPIC}/${ch + 1}`, on ? '1' : '0');
  }

  document.getElementById(`relay-${ch}`)?.classList.toggle('active', on);
  document.getElementById(`note-${ch}`)?.classList.toggle('firing', on);

  const bar = document.getElementById(`bar-${ch}`);
  if (bar) {
    if (on) {
      bar.style.height = `${15 + Math.random() * 25}px`;
      if (dom.statMotor) {
        dom.statMotor.textContent = 'ACTIVE';
        dom.statMotor.className = 'metric-value green';
      }
    } else {
      setTimeout(() => {
        bar.style.height = '4px';
        if (!relayState.some(Boolean) && dom.statMotor) {
          dom.statMotor.textContent = 'IDLE';
          dom.statMotor.className = 'metric-value orange';
        }
      }, 80);
    }
  }
}

// ─── PLAYER CONTROLLER ─────────────────────────────────────────────────────
function getSongBPM(song) {
  if (!song || !song.meta) return 90;
  const match = song.meta.match(/(\d+)\s*BPM/i);
  return match ? parseInt(match[1], 10) : 90;
}

function getSongDuration(songNotes, bpm) {
  if (!songNotes || songNotes.length === 0) return 0;
  const beatMs = 60000 / bpm;
  const totalMs = songNotes.reduce((acc, item) => acc + (item.d * beatMs), 0);
  return Math.max(1, Math.round(totalMs / 1000));
}

function formatTime(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function selectSong(i) {
  if (i < 0 || i >= songs.length) return;
  stopAll();

  document.querySelectorAll('.song-item').forEach(el => el.classList.remove('active'));
  document.getElementById(`song-${i}`)?.classList.add('active');

  activeSong = i;
  seqIdx = 0;

  const s = songs[i];
  if (dom.npTitle) dom.npTitle.textContent = s.title.toUpperCase();

  const bpm = getSongBPM(s);
  if (dom.tempoSlider) dom.tempoSlider.value = bpm;
  if (dom.tempoVal) dom.tempoVal.textContent = bpm;

  const duration = getSongDuration(s.notes, bpm);
  if (dom.timeTotal) dom.timeTotal.textContent = formatTime(duration);
  if (dom.progressFill) dom.progressFill.style.width = '0%';
  if (dom.timeCur) dom.timeCur.textContent = '0:00';
}

function togglePlay() {
  if (activeSong < 0) selectSong(0);
  isPlaying ? pauseSong() : playSong();
}

function playSong() {
  if (activeSong < 0) return;
  initAudio();
  clearTimeout(seqTimer);
  clearTimeout(noteOffTimer);

  const s = songs[activeSong];
  if (seqIdx >= s.notes.length) seqIdx = 0;

  isPlaying = true;
  if (dom.playBtn) dom.playBtn.textContent = '⏸';

  runNote();
}

function pauseSong() {
  isPlaying = false;
  if (dom.playBtn) dom.playBtn.textContent = '▶';
  clearTimeout(seqTimer);
  clearTimeout(noteOffTimer);
  for (let i = 0; i < 8; i++) fireRelay(i, false);
}

function stopAll() {
  pauseSong();
  seqIdx = 0;
  if (dom.progressFill) dom.progressFill.style.width = '0%';
  if (dom.timeCur) dom.timeCur.textContent = '0:00';
}

function updateProgressUI() {
  if (activeSong < 0) return;
  const s = songs[activeSong];
  const bpm = parseInt(dom.tempoSlider?.value || '90', 10);
  const totalSec = getSongDuration(s.notes, bpm);

  const beatMs = 60000 / bpm;
  const elapsedMs = s.notes.slice(0, seqIdx).reduce((acc, item) => acc + (item.d * beatMs), 0);
  const elapsedSec = elapsedMs / 1000;

  const pct = Math.min(100, (seqIdx / s.notes.length) * 100);

  if (dom.progressFill) dom.progressFill.style.width = `${pct}%`;
  if (dom.timeCur) dom.timeCur.textContent = formatTime(elapsedSec);
  if (dom.timeTotal) dom.timeTotal.textContent = formatTime(totalSec);
}

function runNote() {
  if (!isPlaying || activeSong < 0) return;

  const seq = songs[activeSong].notes;
  if (seqIdx >= seq.length) {
    stopAll();
    return;
  }

  updateProgressUI();

  const item = seq[seqIdx];
  const bpm = parseInt(dom.tempoSlider?.value || '90', 10);
  const beatMs = 60000 / bpm;
  const stepMs = beatMs * item.d;
  const pulseMs = Math.max(80, stepMs * 0.85);

  const noteList = Array.isArray(item.n) ? item.n : [item.n];
  noteList.forEach(n => { if (n >= 1 && n <= 8) fireRelay(n - 1, true); });

  noteOffTimer = setTimeout(() => {
    noteList.forEach(n => { if (n >= 1 && n <= 8) fireRelay(n - 1, false); });
    
    seqIdx++;
    if (isPlaying) {
      seqTimer = setTimeout(runNote, Math.max(10, stepMs - pulseMs));
    }
  }, pulseMs);
}

function seekSong(e) {
  if (activeSong < 0 || !dom.progressTrack) return;
  const rect = dom.progressTrack.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const percentage = Math.max(0, Math.min(1, clickX / rect.width));

  const s = songs[activeSong];
  const targetIdx = Math.floor(percentage * s.notes.length);
  seqIdx = Math.min(targetIdx, s.notes.length - 1);

  updateProgressUI();

  if (isPlaying) {
    clearTimeout(seqTimer);
    clearTimeout(noteOffTimer);
    for (let i = 0; i < 8; i++) fireRelay(i, false);
    runNote();
  }
}

function initEvents() {
  dom.playBtn?.addEventListener('click', togglePlay);
  dom.btnStop?.addEventListener('click', stopAll);
  dom.btnPrev?.addEventListener('click', () => selectSong(Math.max(0, activeSong - 1)));
  dom.btnNext?.addEventListener('click', () => selectSong(Math.min(songs.length - 1, activeSong + 1)));

  dom.tempoSlider?.addEventListener('input', (e) => {
    if (dom.tempoVal) dom.tempoVal.textContent = e.target.value;
    if (activeSong >= 0) updateProgressUI();
  });

  dom.progressTrack?.addEventListener('click', seekSong);
}

function startClock() {
  setInterval(() => {
    if (!dom.clock) return;
    const n = new Date();
    dom.clock.textContent = [n.getHours(), n.getMinutes(), n.getSeconds()]
      .map(v => String(v).padStart(2, '0'))
      .join(':');
  }, 1000);
}

function initAnimations() {
  if (dom.muhayaraText) {
    dom.muhayaraText.textContent = 'ROBOT';
  }
}