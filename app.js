/* ============================== seed phrases ============================== */

const SEEDS = {
  general: [
    "Sorry, I've lost my voice, I'm using this to talk",
    "Thank you", "Thank you very much", "Yes please", "No thank you",
    "Could you help me please", "Sorry", "Excuse me",
    "How much is this", "How much is that", "How are you",
    "Where is the toilet please", "Can I pay by card",
    "Have a good day", "One moment please",
  ],
  home: [
    "What's for dinner", "Can you make me a cup of tea please",
    "I'm going to bed", "Can you turn the volume down please",
    "I love you", "Can you get the door please",
    "I'm feeling a bit better today", "My throat still hurts",
  ],
  shop: [
    "How much is this", "Do you have this in a different size",
    "Can I pay by card", "Just looking, thanks",
    "Could I get a bag please", "Do you have any more of these in stock",
    "Where can I find the milk", "Could I get a receipt please",
  ],
  cafe: [
    "Could I get a flat white please", "Could I get a black coffee please",
    "A table for two please", "Could I see the menu please",
    "Could we get the bill please", "Could I get some water please",
    "That was lovely, thank you", "To take away please",
  ],
  medical: [
    "I have laryngitis so I can't speak",
    "I need to collect a prescription", "I have an appointment",
    "It hurts here", "Could I book an appointment please",
    "It started about a week ago",
  ],
  help: [
    "Help",
    "I need help",
    "Need medical help here",
    "Call an ambulance please",
    "I can't breathe properly",
    "This is an emergency",
    "I'm okay now, thank you",
  ],
};

// Personalised seeds from Settings: a name introduces itself in Medical and Out,
// and the local emergency number joins Help. Stored phrases are unaffected.
function personalSeeds(context) {
  const out = [];
  if (settings.name) {
    if (context === "medical" || context === "general") out.push(`My name is ${settings.name}`);
  }
  if (settings.emergency && context === "help") out.push(`Call ${settings.emergency} please`);
  return out;
}

const CONTEXTS = [
  { id: "help",    label: "🆘 Help" },
  { id: "general", label: "🌍 Out" },
  { id: "home",    label: "🏠 Home" },
  { id: "shop",    label: "🛒 Shop" },
  { id: "cafe",    label: "☕ Café" },
  { id: "medical", label: "⚕️ Medical" },
];

// User-defined contexts (Settings): no seed phrases of their own - they start from the
// general blend and grow purely from what gets said in them.
function allContexts() {
  return [...CONTEXTS, ...customCtx.map((c) => ({ id: c.id, label: `${c.emoji || "⭐"} ${c.name}` }))];
}
function contextLabel(id) {
  const c = allContexts().find((x) => x.id === id);
  return c ? c.label : id;
}

// Piper voices (~25–75 MB each, downloaded once and kept in browser storage)
// Default is the OpenSLR 83 voice (CC-BY-SA, the cleanest licence of the four);
// "Jenny (Dioco)" naming is a condition of that voice's licence.
const VOICES = [
  { id: "en_GB-northern_english_male-medium", label: "Male, Northern English" },
  { id: "en_GB-alan-medium",                  label: "Alan — male, English" },
  { id: "en_GB-jenny_dioco-medium",           label: "Jenny (Dioco) — female" },
  { id: "en_GB-alba-medium",                  label: "Alba — female, Scottish" },
  { id: "en_US-amy-medium",                   label: "Amy — female, American" },
  { id: "en_US-ryan-medium",                  label: "Ryan — male, American" },
];
const voiceLabel = (id) => (VOICES.find((v) => v.id === id) || { label: id }).label;

/* ============================== state ============================== */

// Everything kept between visits (phrase model, history, settings, places, custom tabs) is
// ONE localStorage record: a single setItem lands whole or not at all, so no save - an
// import included - can leave some parts new and others old. Before 2026-11-19 each part
// had its own key; those still load, and the first save that works removes them.
const LS_STATE = "th-state-v2";
const LS_V1 = { model: "th-model-v1", hist: "th-hist-v1", settings: "th-settings-v1", places: "th-places-v1", customCtx: "th-cctx-v1" };
const LS_CTX = "th-ctx-v1";
const LS_VOICE = "th-voice-v1";

// Storage can be full, switched off (private modes, blocked site data) or throw on any
// access. None of that may stop Speak or Show: everything lives in memory first, a read
// that fails starts empty, and a write that fails only means this session isn't kept -
// which the person is told once (and again only after every failed save has since worked).
function readRaw(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
const unsaved = new Set(); // keys whose latest save failed
function store(key, value, quiet = false) {
  try {
    localStorage.setItem(key, value);
    unsaved.delete(key);
    return true;
  } catch (e) {
    console.warn(`Couldn't save ${key}:`, e);
    if (!quiet) {
      if (!unsaved.size) toast("Couldn't save on this device - new phrases and changes will be lost when the app closes.", true);
      unsaved.add(key);
    }
    return false;
  }
}
const isObj = (x) => !!x && typeof x === "object" && !Array.isArray(x);
const asList = (v) => (Array.isArray(v) ? v.filter(isObj) : []);
// Own entries only: a context id or phrase such as "constructor" must not find Object's.
const own = (o, k) => (isObj(o) && Object.hasOwn(o, k) ? o[k] : undefined);
const BUILTIN_IDS = new Set(CONTEXTS.map((c) => c.id));

const savedState = loadJSON(LS_STATE);
const part = (name) => (isObj(savedState) ? savedState[name] : loadJSON(LS_V1[name]));
let model = part("model");
if (!isObj(model) || !isObj(model.contexts)) model = { contexts: {} };
let hist = asList(part("hist")); // [{text, t}] newest first
const savedSettings = part("settings");
let settings = { name: "", emergency: "", onlineVoices: false, ...(isObj(savedSettings) ? savedSettings : {}) };
let places = asList(part("places")); // [{id, name, ctx, lat, lon, radius}]
let customCtx = asList(part("customCtx")).filter((c) => typeof c.id === "string" && c.id && !BUILTIN_IDS.has(c.id)); // [{id, name, emoji}]

let legacyCleared = false;
function saveState(quiet = false) {
  if (!store(LS_STATE, JSON.stringify({ model, hist, settings, places, customCtx }), quiet)) return false;
  if (!legacyCleared) {
    legacyCleared = true; // the old per-part keys are now stale copies (forgotten phrases too)
    for (const k of Object.values(LS_V1)) { try { localStorage.removeItem(k); } catch {} }
  }
  return true;
}
let ctx = readRaw(LS_CTX) || "general";
if (![...CONTEXTS, ...customCtx.map((c) => ({ id: c.id }))].some((c) => c.id === ctx)) ctx = "general";
let voiceId = readRaw(LS_VOICE) || VOICES[0].id;
if (!VOICES.some((v) => v.id === voiceId)) voiceId = VOICES[0].id;
let words = [];    // current sentence under construction
let lastText = ""; // last spoken sentence, for "say again"

const $ = (id) => document.getElementById(id);

/* ============================== model / prediction ============================== */

function loadJSON(key) {
  try { return JSON.parse(readRaw(key)); } catch { return null; }
}
const saveModel = () => saveState();

// A learned phrase's record, or undefined (own entries only, see own()).
const learnedRec = (context, text) => own(own(model.contexts, context)?.sentences, text);

// All candidate sentences for a context: seeds (weight 1) merged with
// learned sentences (weight = times spoken), general seeds as fallback pool.
function sentencesFor(context) {
  const out = new Map(); // text -> weight
  for (const s of own(SEEDS, context) || []) out.set(s, 1);
  for (const s of personalSeeds(context)) out.set(s, 1.2); // personal lines float up a little
  // Blend in general phrases everywhere except Help, which stays urgent-only.
  if (context !== "general" && context !== "help")
    for (const s of SEEDS.general) out.set(s, out.get(s) || 0.5);
  const learned = own(model.contexts, context)?.sentences;
  for (const [text, rec] of Object.entries(isObj(learned) ? learned : {})) {
    if (Number.isFinite(rec?.c)) out.set(text, (out.get(text) || 0) + rec.c);
  }
  return out;
}

function predict() {
  const prefix = words.join(" ").toLowerCase();
  const pool = sentencesFor(ctx);

  const nextWords = new Map();   // word -> weight
  const completions = [];        // { text, weight }

  for (const [text, weight] of pool) {
    const lower = text.toLowerCase();
    if (prefix) {
      if (!lower.startsWith(prefix)) continue;
      if (lower.length === prefix.length) continue;      // sentence fully typed
      if (lower[prefix.length] !== " ") continue;        // word-boundary match only
    }
    completions.push({ text, weight });
    const rest = text.slice(prefix ? prefix.length + 1 : 0);
    const next = rest.split(/\s+/)[0];
    if (next) nextWords.set(next, (nextWords.get(next) || 0) + weight);
  }

  // Bigram fallback: nothing matches the whole prefix, so predict from the
  // last word alone using every sentence we know about (custom contexts included).
  if (nextWords.size === 0 && words.length > 0) {
    const last = words[words.length - 1].toLowerCase();
    for (const context of new Set([...Object.keys(SEEDS), ...Object.keys(model.contexts)])) {
      for (const [text, weight] of sentencesFor(context)) {
        const toks = text.split(/\s+/);
        for (let i = 0; i < toks.length - 1; i++) {
          if (toks[i].toLowerCase() === last) {
            const w = toks[i + 1];
            nextWords.set(w, (nextWords.get(w) || 0) + weight);
          }
        }
      }
    }
  }

  completions.sort((a, b) => b.weight - a.weight);
  const wordList = [...nextWords.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([w]) => w)
    .slice(0, 8);

  return { completions: completions.slice(0, 4), wordList };
}

function learn(text) {
  const c = own(model.contexts, ctx) || (model.contexts[ctx] = { sentences: {} });
  if (!isObj(c.sentences)) c.sentences = {};
  const rec = own(c.sentences, text) || (c.sentences[text] = { c: 0, t: 0 });
  rec.c += 1;
  rec.t = Date.now();
  saveModel();
}

function pushHistory(text) {
  hist = [{ text, t: Date.now() }, ...hist.filter((h) => h.text !== text)].slice(0, 30);
  saveState();
}

/* ============================== rendering ============================== */

function renderContexts() {
  $("contexts").innerHTML = "";
  for (const c of allContexts()) {
    const b = document.createElement("button");
    b.className = "ctx" + (c.id === ctx ? " active" : "") + (c.id === "help" ? " help" : "");
    b.textContent = c.label;
    b.onclick = () => {
      ctx = c.id;
      manualCtx = true; // a deliberate choice beats the geofence for this session
      store(LS_CTX, ctx);
      renderContexts();
      renderSuggestions();
    };
    $("contexts").appendChild(b);
  }
}

function renderSentence() {
  const bar = $("sentenceBar");
  bar.innerHTML = "";
  if (words.length === 0) {
    const p = document.createElement("span");
    p.className = "placeholder";
    p.textContent = "Tap words below to build a sentence…";
    bar.appendChild(p);
  } else {
    words.forEach((w, i) => {
      const t = document.createElement("span");
      t.className = "token";
      t.textContent = w;
      t.title = "Remove this word and everything after it";
      t.onclick = () => { words = words.slice(0, i); refresh(); };
      bar.appendChild(t);
    });
  }
  const btns = document.createElement("span");
  btns.id = "barBtns";
  const back = document.createElement("button");
  back.textContent = "⌫";
  back.onclick = () => { words.pop(); refresh(); };
  const clear = document.createElement("button");
  clear.textContent = "✕";
  clear.onclick = () => { words = []; refresh(); };
  btns.append(back, clear);
  bar.appendChild(btns);
}

function renderSuggestions() {
  const { completions, wordList } = predict();

  const compEl = $("completions");
  compEl.innerHTML = "";
  $("completionsHead").textContent = words.length ? "Finish the sentence" : "Say it in one tap";
  for (const c of completions) {
    const b = document.createElement("button");
    b.className = "chip completion";
    const label = document.createElement("span");
    label.textContent = c.text;
    b.appendChild(label);
    const lift = document.createElement("span");
    lift.className = "lift";
    lift.setAttribute("role", "button");
    // SVG rather than a "↑" glyph: arrow characters have lopsided font
    // metrics and refuse to centre vertically in the pill.
    lift.innerHTML =
      '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">' +
      '<path d="M6 10.5V2M2.5 5 6 1.5 9.5 5" fill="none" stroke="currentColor" ' +
      'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    lift.title = "Put in the sentence bar to add more words";
    lift.onclick = (e) => {
      e.stopPropagation();
      words = c.text.split(/\s+/);
      refresh();
    };
    b.appendChild(lift);
    b.onclick = () => { if (b.dataset.held) { delete b.dataset.held; return; } words = c.text.split(/\s+/); refresh(); speak(); };
    attachLongPressForget(b, c.text);
    compEl.appendChild(b);
  }
  if (completions.length === 0) {
    compEl.innerHTML = '<div class="empty">No saved sentence matches — keep going, it will learn this one.</div>';
  }

  const wordsEl = $("words");
  wordsEl.innerHTML = "";
  for (const w of wordList) {
    const b = document.createElement("button");
    b.className = "chip";
    b.textContent = w;
    b.onclick = () => { words.push(w); refresh(); };
    wordsEl.appendChild(b);
  }
  if (wordList.length === 0) {
    wordsEl.innerHTML = '<div class="empty">Type the next word below.</div>';
  }
}

function refresh() {
  renderSentence();
  renderSuggestions();
}

// Long-press a suggestion to forget it (learned phrases only - a typo'd sentence would
// otherwise haunt the suggestions forever). The chip flips to an inline confirm.
function attachLongPressForget(chip, text) {
  let timer = 0, x0 = 0, y0 = 0;
  chip.addEventListener("pointerdown", (e) => {
    x0 = e.clientX; y0 = e.clientY;
    timer = setTimeout(() => {
      timer = 0;
      chip.dataset.held = "1";           // swallow the click that follows the release
      const learned = !!learnedRec(ctx, text);
      chip.innerHTML = "";
      chip.classList.add("confirming");
      const q = document.createElement("span");
      q.textContent = learned ? "Forget this phrase?" : "Built-in phrase - it can't be removed.";
      chip.appendChild(q);
      if (learned) {
        const yes = document.createElement("span");
        yes.className = "lift danger";
        yes.setAttribute("role", "button");
        yes.textContent = "Forget";
        yes.onclick = (ev) => { ev.stopPropagation(); forgetPhrase(ctx, text); toast("Forgotten"); renderSuggestions(); };
        chip.appendChild(yes);
      }
      const no = document.createElement("span");
      no.className = "lift";
      no.setAttribute("role", "button");
      no.textContent = learned ? "Keep" : "OK";
      no.onclick = (ev) => { ev.stopPropagation(); renderSuggestions(); };
      chip.appendChild(no);
      setTimeout(() => { if (chip.classList.contains("confirming")) renderSuggestions(); }, 5000);
    }, 600);
  });
  const cancel = (e) => {
    if (timer && e && e.type === "pointermove" && Math.hypot(e.clientX - x0, e.clientY - y0) < 10) return;
    if (timer) { clearTimeout(timer); timer = 0; }
  };
  chip.addEventListener("pointermove", cancel);
  chip.addEventListener("pointerup", () => { if (timer) { clearTimeout(timer); timer = 0; } });
  chip.addEventListener("pointercancel", cancel);
  chip.addEventListener("pointerleave", cancel);
  chip.addEventListener("contextmenu", (e) => e.preventDefault()); // long-press must not open the menu
}

/* ============================== composer ============================== */

function addTyped() {
  const raw = $("freeText").value.trim();
  if (!raw) return;
  words.push(...raw.split(/\s+/));
  $("freeText").value = "";
  refresh();
}
$("addBtn").onclick = addTyped;
$("freeText").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); addTyped(); }
});

/* ============================== audio: cache + piper + fallback ============================== */

// Tiny silent WAV: played synchronously inside the tap gesture so iOS lets us
// swap in the real (async-generated) audio afterwards.
const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";
const player = $("player");

if ("audioSession" in navigator) {
  try { navigator.audioSession.type = "playback"; } catch {}
}

// --- IndexedDB blob cache -------------------------------------------------
function openDB() {
  return new Promise((res, rej) => {
    // Some WebKit versions never answer indexedDB.open: speech must not wait on the cache.
    setTimeout(() => rej(new Error("audio cache did not open")), 2000);
    const req = indexedDB.open("th-audio", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("clips");
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
async function cacheGet(key) {
  try {
    const db = await openDB();
    return await new Promise((res) => {
      const req = db.transaction("clips").objectStore("clips").get(key);
      req.onsuccess = () => res(req.result || null);
      req.onerror = () => res(null);
    });
  } catch { return null; }
}
async function cachePut(key, blob) {
  try {
    const db = await openDB();
    db.transaction("clips", "readwrite").objectStore("clips").put(blob, key);
  } catch {}
}

// --- Piper (vits-web) ------------------------------------------------------
let tts = null;              // module, once loaded
let piperReady = false;
let piperFailed = false;

function setVoiceStatus(html) { $("voiceStatus").innerHTML = html; }

async function initPiper() {
  try {
    // Self-hosted vits-web (patched: ONNX runtime and phonemizer WASM load from /lib/,
    // voice models still come from Hugging Face and live in OPFS).
    tts = await import("./lib/vits-web.js");
    await refreshVoiceStatus();
  } catch (e) {
    piperFailed = true;
    setVoiceStatus('<span class="status-warn">device voice</span>');
    console.warn("Piper unavailable, falling back to Web Speech:", e);
  }
}

// The Help tab must never wait on synthesis: as soon as a voice is ready, quietly
// synthesise every Help phrase into the audio cache in the background.
let precaching = false;
async function precacheHelpAudio() {
  if (precaching || !piperReady) return;
  precaching = true;
  try {
    const phrases = [...SEEDS.help, ...personalSeeds("help")];
    for (const text of phrases) {
      if (!piperReady) break;                       // voice switched away mid-run
      const key = voiceId + "|" + text.toLowerCase();
      if (await cacheGet(key)) continue;
      const blob = await tts.predict({ text, voiceId });
      await cachePut(key, blob);
      await new Promise((r) => setTimeout(r, 250)); // keep the UI responsive
    }
  } catch (e) {
    console.warn("Help pre-cache stopped:", e);
  } finally {
    precaching = false;
  }
}

// Re-evaluate whether the currently selected voice is downloaded.
async function refreshVoiceStatus() {
  if (!tts) return;
  piperReady = false;
  const stored = await tts.stored();
  if (stored.includes(voiceId)) {
    piperReady = true;
    setVoiceStatus('<span class="status-ok">● ready</span>');
    precacheHelpAudio();
  } else {
    setVoiceStatus('<button id="dlVoice">Download (~60 MB)</button>');
    $("dlVoice").onclick = downloadVoice;
  }
}

let downloading = false;
async function downloadVoice() {
  if (downloading || !tts) return;
  downloading = true;
  const wanted = voiceId;
  setVoiceStatus("downloading… 0%");
  try {
    await tts.download(wanted, (p) => {
      if (voiceId !== wanted) return;
      // The HF CDN sometimes streams without a content-length; fall back to MB counted.
      setVoiceStatus(p.total
        ? `downloading… ${Math.round((p.loaded / p.total) * 100)}%`
        : `downloading… ${Math.round(p.loaded / 1048576)} MB`);
    });
  } catch (e) {
    console.warn("Voice download failed:", e);
    if (voiceId === wanted) {
      setVoiceStatus('<span class="status-warn">download failed</span>');
      downloading = false;
      return;
    }
  }
  downloading = false;
  await refreshVoiceStatus();
}

function renderVoices() {
  const sel = $("voiceSel");
  sel.innerHTML = "";
  for (const v of VOICES) {
    const o = document.createElement("option");
    o.value = v.id;
    o.textContent = v.label;
    o.selected = v.id === voiceId;
    sel.appendChild(o);
  }
  sel.onchange = () => {
    voiceId = sel.value;
    store(LS_VOICE, voiceId);
    refreshVoiceStatus();
  };
}

// A ~5 s pre-rendered sample per voice, so nobody commits to a 60 MB download blind.
$("voicePlay").onclick = async () => {
  player.src = `samples/${voiceId}.wav`;
  try { await player.play(); } catch { toast("No preview available for this voice.", true); }
};

// --- speak -----------------------------------------------------------------
// A browser's own voices can be online ones (Chrome's "Google" voices, Edge's "Online"
// voices send the text to a server to be spoken). Nothing is meant to leave the device,
// so only voices that report SpeechSynthesisVoice.localService are used unless online
// voices are switched on in Settings. With no usable voice the sentence is still on the
// big-text screen, and a note there says why it wasn't spoken.
let voicesWaited = false;
function deviceVoices() {
  const synth = window.speechSynthesis;
  if (!synth) return Promise.resolve([]);
  const now = synth.getVoices();
  if (now.length || voicesWaited) return Promise.resolve(now);
  voicesWaited = true; // Chrome fills the list asynchronously: wait for it once
  return new Promise((res) => {
    const done = () => { clearTimeout(timer); synth.removeEventListener?.("voiceschanged", done); res(synth.getVoices()); };
    const timer = setTimeout(done, 1500);
    synth.addEventListener?.("voiceschanged", done);
  });
}

function notSpoken(reason) {
  const synth = !!window.speechSynthesis, online = settings.onlineVoices === true;
  const why = reason || (!synth ? "this browser has no built-in voice"
    : online ? "the device voice isn't working" : "this device has no voice that works offline");
  const fixes = [];
  if (tts && !piperReady) fixes.push("download a voice at the top of the app");
  if (synth && !online) fixes.push("allow online voices in Settings");
  $("overlayNote").textContent = `Not spoken: ${why}.` + (fixes.length ? ` To hear it, ${fixes.join(" or ")}.` : "");
  $("overlayNote").hidden = false;
}

async function webSpeech(text) {
  try {
    const online = settings.onlineVoices === true;
    const all = await deviceVoices();
    const pool = online ? all : all.filter((v) => v.localService);
    const v = pool.find((v) => v.lang.startsWith("en-GB")) || pool.find((v) => v.lang.startsWith("en"))
           || (online ? null : pool.find((v) => v.default) || pool[0]);
    if (!v && !online) { notSpoken(); return; }
    const u = new SpeechSynthesisUtterance(text);
    if (v) u.voice = v; // online allowed and no English voice: the browser's default
    u.onerror = (e) => { if (e.error !== "interrupted" && e.error !== "canceled") notSpoken("the device voice failed"); };
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch (e) {
    console.warn("Device voice failed:", e);
    notSpoken();
  }
}

// Audio pipeline only — no learning; the one UI it touches is the not-spoken note. Reused by "say again".
async function speakText(text) {
  $("overlayNote").hidden = true;
  // Unlock the audio element inside the tap gesture (iOS requirement).
  player.src = SILENT_WAV;
  player.play().catch(() => {});

  try {
    const key = voiceId + "|" + text.toLowerCase();
    let blob = await cacheGet(key);
    if (!blob && piperReady) {
      blob = await tts.predict({ text, voiceId });
      cachePut(key, blob);
    }
    if (blob) {
      player.src = URL.createObjectURL(blob);
      await player.play();
    } else {
      await webSpeech(text); // model not downloaded / unavailable
    }
  } catch (e) {
    console.warn("Neural speak failed, using device voice:", e);
    await webSpeech(text);
  }
}

// Take the composed sentence: show it, learn it, and clear the bar so the app is
// immediately ready for the next sentence (speak() then says it). Showing comes first and
// nothing after it can stop it or the speech: learning and history are extras, and stay
// in memory for the session if storage won't save them.
function takeSentence() {
  const typed = $("freeText").value.trim();
  if (typed) { words.push(...typed.split(/\s+/)); $("freeText").value = ""; }
  const text = words.join(" ");
  if (!text) return null;
  lastText = text;
  words = [];
  showOverlay(text);
  try { learn(text); pushHistory(text); } catch (e) { console.warn("Couldn't learn this sentence:", e); }
  try { refresh(); } catch (e) { console.warn("Couldn't refresh suggestions:", e); }
  return text;
}

async function speak() {
  const text = takeSentence();
  if (!text) return;
  const btn = $("speakBtn");
  btn.classList.add("busy");
  try { await speakText(text); } finally { btn.classList.remove("busy"); }
}

$("speakBtn").onclick = speak;
$("againBtn").onclick = (e) => {
  e.stopPropagation(); // keep the overlay open
  if (lastText) speakText(lastText);
};

/* ============================== big-text overlay ============================== */

function showOverlay(text) {
  $("overlayText").textContent = text;
  $("overlayNote").hidden = true;
  $("overlay").classList.add("show");
}
$("overlay").onclick = () => $("overlay").classList.remove("show");
$("showBtn").onclick = () => takeSentence();

/* ============================== history sheet ============================== */

function timeAgo(t) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return m + " min ago";
  if (m < 60 * 24) return Math.round(m / 60) + " hr ago";
  return new Date(t).toLocaleDateString();
}

function renderHistory() {
  const list = $("histList");
  list.innerHTML = "";
  if (hist.length === 0) {
    list.innerHTML = '<div class="empty">Nothing said yet.</div>';
    return;
  }
  for (const h of hist) {
    const b = document.createElement("button");
    b.className = "histItem";
    b.textContent = h.text;
    const when = document.createElement("span");
    when.className = "when";
    when.textContent = timeAgo(h.t);
    b.appendChild(when);
    b.onclick = () => {
      $("histPanel").classList.remove("show");
      lastText = h.text;
      showOverlay(h.text);
      speakText(h.text); // no learn(): repeating isn't a new use
    };
    list.appendChild(b);
  }
}

$("histBtn").onclick = () => { renderHistory(); $("histPanel").classList.add("show"); };
$("histPanel").onclick = (e) => {
  if (e.target.id === "histPanel") $("histPanel").classList.remove("show");
};

/* ============================== toast ============================== */

let toastTimer = 0;
function toast(msg, isError = false) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.toggle("error", isError);
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), isError ? 4000 : 2600);
}

/* ============================== settings sheet ============================== */

const saveSettings = () => saveState();
const savePlaces = () => saveState();

const EMERGENCY_NUMBERS = ["", "000", "999", "911", "112", "111"];

function renderSettings() {
  $("setName").value = settings.name;
  $("setOnlineVoices").checked = settings.onlineVoices === true;
  const sel = $("setEmergency");
  sel.innerHTML = "";
  for (const n of EMERGENCY_NUMBERS) {
    const o = document.createElement("option");
    o.value = n;
    o.textContent = n === "" ? "None - no number in phrases" : n;
    o.selected = n === settings.emergency;
    sel.appendChild(o);
  }
  const list = $("placesList");
  list.innerHTML = "";
  if (places.length === 0) {
    list.innerHTML = '<div class="empty">No saved places. Add one and the matching context opens by itself when you arrive.</div>';
  }
  for (const p of places) {
    const row = document.createElement("div");
    row.className = "placeRow";
    const label = document.createElement("span");
    label.textContent = `${p.name} → ${contextLabel(p.ctx)} (${p.radius} m)`;
    const del = document.createElement("button");
    del.textContent = "✕";
    del.title = "Remove this place";
    del.onclick = () => { places = places.filter((x) => x !== p); savePlaces(); renderSettings(); };
    row.append(label, del);
    list.appendChild(row);
  }
  renderCustomCtxList();
  renderPhraseManager();
  renderVoiceStore();
}

/* ---- custom contexts ---- */

const saveCustomCtx = () => saveState();

function renderCustomCtxList() {
  const list = $("ctxList");
  list.innerHTML = "";
  if (customCtx.length === 0) {
    list.innerHTML = '<div class="empty">No extra tabs yet. Add one (say, Work or School run) and it learns its own phrases.</div>';
  }
  for (const c of customCtx) {
    const row = document.createElement("div");
    row.className = "placeRow";
    const label = document.createElement("span");
    const n = Object.keys(own(model.contexts, c.id)?.sentences || {}).length;
    label.textContent = `${c.emoji || "⭐"} ${c.name}${n ? ` (${n} learned phrase${n === 1 ? "" : "s"})` : ""}`;
    const del = document.createElement("button");
    del.textContent = "✕";
    del.title = "Remove this tab";
    del.onclick = () => {
      const n2 = Object.keys(own(model.contexts, c.id)?.sentences || {}).length;
      if (!confirm(`Remove the "${c.name}" tab${n2 ? ` and its ${n2} learned phrase${n2 === 1 ? "" : "s"}` : ""}?`)) return;
      customCtx = customCtx.filter((x) => x !== c);
      delete model.contexts[c.id];
      places = places.filter((p) => p.ctx !== c.id);   // geofences pointing at it go too
      saveState();                                      // all three changes in one write
      if (ctx === c.id) { ctx = "general"; store(LS_CTX, ctx); }
      renderContexts();
      renderSuggestions();
      renderSettings();
    };
    row.append(label, del);
    list.appendChild(row);
  }
}

$("addCtxBtn").onclick = () => {
  const name = $("ctxName").value.trim();
  if (!name) { $("ctxName").focus(); return; }
  const emoji = $("ctxEmoji").value.trim().slice(0, 4);
  customCtx.push({ id: "c-" + crypto.randomUUID(), name, emoji });
  saveCustomCtx();
  $("ctxName").value = "";
  $("ctxEmoji").value = "";
  renderContexts();
  renderSettings();
  toast(`Added "${name}"`);
};

/* ---- learned-phrase manager ---- */

function forgetPhrase(context, text) {
  if (!learnedRec(context, text)) return false;
  delete model.contexts[context].sentences[text];
  saveModel();
  return true;
}

function renderPhraseManager() {
  const sel = $("phraseCtx");
  const prev = sel.value;
  sel.innerHTML = "";
  for (const c of allContexts()) {
    const o = document.createElement("option");
    o.value = c.id;
    o.textContent = c.label;
    sel.appendChild(o);
  }
  sel.value = allContexts().some((c) => c.id === prev) ? prev : ctx;
  const list = $("phraseList");
  list.innerHTML = "";
  const learned = Object.entries(own(model.contexts, sel.value)?.sentences || {}).sort((a, b) => b[1].c - a[1].c);
  if (learned.length === 0) {
    list.innerHTML = '<div class="empty">Nothing learned in this tab yet. Everything you speak lands here, most-used first.</div>';
    return;
  }
  for (const [text, rec] of learned) {
    const row = document.createElement("div");
    row.className = "placeRow";
    const label = document.createElement("span");
    label.textContent = `${text} `;
    const count = document.createElement("small");
    count.className = "when";
    count.textContent = `×${rec.c}`;
    label.appendChild(count);
    const del = document.createElement("button");
    del.textContent = "✕";
    del.title = "Forget this phrase";
    del.onclick = () => { forgetPhrase(sel.value, text); renderPhraseManager(); renderSuggestions(); };
    row.append(label, del);
    list.appendChild(row);
  }
}
$("phraseCtx").addEventListener("change", renderPhraseManager);

/* ---- downloaded-voice manager ---- */

async function renderVoiceStore() {
  const list = $("voiceStore");
  list.innerHTML = "";
  if (!tts) {
    list.innerHTML = '<div class="empty">Neural voices are unavailable on this device - its built-in voice is used instead, if it has one that works offline (or online voices are allowed below).</div>';
    return;
  }
  let stored = [];
  try { stored = await tts.stored(); } catch { /* leave empty */ }
  if (stored.length === 0) {
    list.innerHTML = '<div class="empty">No voices downloaded yet - pick one at the top and tap Download.</div>';
  }
  for (const id of stored) {
    const row = document.createElement("div");
    row.className = "placeRow";
    const label = document.createElement("span");
    label.textContent = voiceLabel(id) + (id === voiceId ? " · in use" : "");
    const del = document.createElement("button");
    del.textContent = "✕";
    del.title = "Remove this voice from the device";
    del.onclick = async () => {
      if (!confirm(`Remove "${voiceLabel(id)}" (~60 MB)? It can be downloaded again any time.`)) return;
      try { await tts.remove(id); } catch (e) { toast(`Couldn't remove: ${e.message}`, true); return; }
      await refreshVoiceStatus();
      renderVoiceStore();
    };
    row.append(label, del);
    list.appendChild(row);
  }
  if (navigator.storage?.estimate) {
    try {
      const est = await navigator.storage.estimate();
      const note = document.createElement("div");
      note.className = "empty";
      note.textContent = `This site is using about ${Math.max(1, Math.round((est.usage || 0) / 1048576))} MB of browser storage in total.`;
      list.appendChild(note);
    } catch { /* fine without */ }
  }
}

$("setName").addEventListener("change", () => {
  settings.name = $("setName").value.trim();
  saveSettings();
  renderSuggestions();
});
$("setEmergency").addEventListener("change", () => {
  settings.emergency = $("setEmergency").value;
  saveSettings();
  renderSuggestions();
});
$("setOnlineVoices").addEventListener("change", () => {
  settings.onlineVoices = $("setOnlineVoices").checked;
  saveSettings();
});

// An iPhone Home Screen app follows Location Services > System Services > In-App Web Browsing
// (not Safari Websites), and only reads it when the app starts (found on whatsacross.com
// 2026-10-10). A toast is too brief for that, so it goes under the Save button.
const IOS_APP = (/iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1))
  && (navigator.standalone === true || matchMedia("(display-mode: standalone)").matches);

$("addPlaceBtn").onclick = () => {
  if (!navigator.geolocation) { toast("This device can't give a location.", true); return; }
  const name = $("placeName").value.trim();
  if (!name) { $("placeName").focus(); return; }
  const b = $("addPlaceBtn");
  b.disabled = true;
  b.textContent = "Locating…";
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      places.push({
        id: crypto.randomUUID(),
        name,
        ctx: $("placeCtx").value,
        lat: +pos.coords.latitude.toFixed(6),
        lon: +pos.coords.longitude.toFixed(6),
        radius: parseInt($("placeRadius").value, 10),
      });
      savePlaces();
      $("placeName").value = "";
      renderSettings();
      b.disabled = false;
      b.textContent = "📍 Save this location";
      $("placeHelp").hidden = true;
      toast(`Saved "${name}"`);
    },
    (err) => {
      b.disabled = false;
      b.textContent = "📍 Save this location";
      toast("Couldn't get a location - check permission.", true);
      if (IOS_APP && err && (err.code === 1 || err.code === 2)) {
        const device = /iPad|Macintosh/.test(navigator.userAgent) ? "iPad" : "iPhone";
        $("placeHelp").textContent = `Location is blocked. On ${device}, an app added to the Home Screen needs Settings › Privacy & Security › Location Services › System Services › In-App Web Browsing switched on - then close Talking Hurts fully (swipe it away in the app switcher) and open it again.`;
        $("placeHelp").hidden = false;
      }
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
  );
};

$("setBtn").onclick = () => {
  // Rebuild the place-context picker each open: custom tabs may have changed.
  const pc = $("placeCtx");
  const prev = pc.value;
  pc.innerHTML = "";
  for (const c of allContexts()) {
    const o = document.createElement("option");
    o.value = c.id;
    o.textContent = c.label;
    o.selected = prev ? c.id === prev : c.id === "home";
    pc.appendChild(o);
  }
  renderSettings();
  $("setPanel").classList.add("show");
};
$("setPanel").onclick = (e) => {
  if (e.target.id === "setPanel") $("setPanel").classList.remove("show");
};

/* ============================== export / import ============================== */

$("exportBtn").onclick = async () => {
  const payload = {
    app: "talkinghurts.com",
    schema: 1,
    exported: new Date().toISOString(),
    model, hist, settings, places, customCtx,
  };
  const stamp = new Date().toISOString().slice(0, 10);
  const file = new File([JSON.stringify(payload, null, 1)], `talking-hurts-${stamp}.json`, { type: "application/json" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: "Talking Hurts backup" }); return; }
    catch (e) { if (e.name === "AbortError") return; }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
};

// Build the merged state from a backup without touching the live state: every section is
// checked and merged into copies first, so a damaged file changes nothing at all.
function mergeBackup(d) {
  if (!isObj(d) || d.app !== "talkinghurts.com" || d.schema !== 1) throw new Error("not a Talking Hurts backup");
  const section = (name, ok) => {
    if (d[name] == null) return null;
    if (!ok(d[name])) throw new Error(`the ${name} part of the file is damaged`);
    return d[name];
  };
  const inModel = section("model", (m) => isObj(m) && (m.contexts == null || isObj(m.contexts)));
  const inHist = section("hist", Array.isArray);
  const inSettings = section("settings", isObj);
  const inCtx = section("customCtx", Array.isArray);
  const inPlaces = section("places", Array.isArray);
  const str = (x) => typeof x === "string" && x.trim() !== "";
  const next = {
    model: JSON.parse(JSON.stringify(model)),
    hist: [...hist], settings: { ...settings }, customCtx: [...customCtx], places: [...places],
  };
  // Tabs first, so every phrase and place below can be checked against the merged set.
  // Tab ids are always "c-" + a UUID. A tab with the same name as one here is the same tab
  // (each device made its own id), so its phrases and places join this device's tab.
  const remap = new Map(), byName = new Map(next.customCtx.map((c) => [c.name, c.id]));
  for (const c of inCtx || []) {
    if (!isObj(c) || typeof c.id !== "string" || !/^c-[0-9a-f-]{8,64}$/i.test(c.id) || !str(c.name)) continue;
    if (byName.has(c.name)) { if (byName.get(c.name) !== c.id) remap.set(c.id, byName.get(c.name)); continue; }
    if (next.customCtx.some((x) => x.id === c.id)) continue;
    next.customCtx.push({ id: c.id, name: c.name, emoji: typeof c.emoji === "string" ? c.emoji.slice(0, 4) : "" });
    byName.set(c.name, c.id);
  }
  const known = new Set([...BUILTIN_IDS, ...next.customCtx.map((c) => c.id)]);
  const tabOf = (id) => { const t = remap.get(id) || id; return known.has(t) ? t : null; };
  let phrases = 0, dropped = 0;
  // Merge, never overwrite: counts add up, so phone + PC learning combine.
  for (const [cid, c] of Object.entries(inModel?.contexts || {})) {
    if (!isObj(c) || !isObj(c.sentences)) continue;
    const tab = tabOf(cid);
    if (!tab) { dropped += Object.keys(c.sentences).length; continue; } // no such tab, here or in the file
    const mine = own(next.model.contexts, tab) || (next.model.contexts[tab] = { sentences: {} });
    if (!isObj(mine.sentences)) mine.sentences = {};
    for (const [text, rec] of Object.entries(c.sentences)) {
      if (text === "__proto__" || !text.trim() || !isObj(rec) || !Number.isFinite(rec.c) || rec.c <= 0) continue;
      const r = own(mine.sentences, text) || (mine.sentences[text] = { c: 0, t: 0 });
      r.c += rec.c;
      r.t = Math.max(r.t, Number.isFinite(rec.t) ? rec.t : 0);
      phrases++;
    }
  }
  const seen = new Set(next.hist.map((h) => h.text));
  for (const h of inHist || []) {
    if (isObj(h) && str(h.text) && !seen.has(h.text)) { next.hist.push({ text: h.text, t: Number.isFinite(h.t) ? h.t : 0 }); seen.add(h.text); }
  }
  next.hist.sort((a, b) => b.t - a.t);
  next.hist = next.hist.slice(0, 30);
  // Fill gaps in the name and number only: an imported file never switches online voices on.
  if (inSettings) {
    if (!next.settings.name && str(inSettings.name)) next.settings.name = inSettings.name;
    if (!next.settings.emergency && str(inSettings.emergency)) next.settings.emergency = inSettings.emergency;
  }
  const names = new Set(next.places.map((p) => p.name));
  for (const p of inPlaces || []) {
    const tab = isObj(p) ? tabOf(p.ctx) : null;
    if (!tab) { if (isObj(p)) dropped++; continue; }
    if (str(p.name) && !names.has(p.name) && Number.isFinite(p.lat) && Number.isFinite(p.lon)
        && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180) {
      next.places.push({ id: str(p.id) ? p.id : crypto.randomUUID(), name: p.name, ctx: tab,
        lat: p.lat, lon: p.lon, radius: Number.isFinite(p.radius) && p.radius > 0 ? p.radius : 150 });
      names.add(p.name);
    }
  }
  return { next, phrases, dropped };
}

$("importBtn").onclick = () => $("importFile").click();
$("importFile").addEventListener("change", async () => {
  const f = $("importFile").files[0];
  $("importFile").value = "";
  if (!f) return;
  let merged;
  try {
    merged = mergeBackup(JSON.parse(await f.text()));
  } catch (e) {
    toast(`Import failed: ${e.message}. Nothing was changed.`, true);
    return;
  }
  // The whole merge is swapped in at once and saved as the one record, so it is on the
  // device entirely or not at all. If this device won't save, it is still used for this
  // session (like everything else when storage fails).
  ({ model, hist, settings, customCtx, places } = merged.next);
  const saved = saveState(true);
  renderContexts();
  renderSettings();
  renderSuggestions();
  const n = `${merged.phrases} learned phrase${merged.phrases === 1 ? "" : "s"}`
    + (merged.dropped ? ` (${merged.dropped} for tabs that don't exist left out)` : "");
  if (saved) toast(`Imported ${n}`);
  else toast(`Imported ${n} for now, but this device couldn't save them - they will be lost when the app closes.`, true);
});

/* ============================== geofencing (foreground only) ============================== */

let manualCtx = false;
let lastGeoCheck = 0;

function distM(aLat, aLon, bLat, bLon) {
  const R = 6371000, d = Math.PI / 180;
  const x = (bLon - aLon) * d * Math.cos(((aLat + bLat) / 2) * d);
  const y = (bLat - aLat) * d;
  return Math.hypot(x, y) * R;
}

// On open (and when the tab comes back into view) quietly ask where we are; if a saved
// place matches, switch to its context. A manual context choice wins for the session.
// No saved places = no location request at all.
function geoCheck() {
  if (!places.length || manualCtx || !navigator.geolocation) return;
  if (Date.now() - lastGeoCheck < 60000) return;
  lastGeoCheck = Date.now();
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      // Only places whose tab still exists take part: an orphaned place nearer by must
      // not hide a usable one.
      const tabs = new Set(allContexts().map((c) => c.id));
      let best = null, bestD = Infinity;
      for (const p of places) {
        if (!tabs.has(p.ctx)) continue;
        const dd = distM(pos.coords.latitude, pos.coords.longitude, p.lat, p.lon);
        if (dd <= p.radius && dd < bestD) { best = p; bestD = dd; }
      }
      if (best && best.ctx !== ctx) {
        ctx = best.ctx;
        store(LS_CTX, ctx, true); // background switch: no storage warning over its own toast
        renderContexts();
        renderSuggestions();
        toast(`📍 ${best.name}`);
      }
    },
    () => {}, // denied or unavailable: stay quiet
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 120000 },
  );
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) geoCheck(); });

/* ============================== boot ============================== */

// iOS loads voices asynchronously; poke the list early so the fallback works.
window.speechSynthesis?.getVoices(); // a bare speechSynthesis would throw where it is missing

renderContexts();
renderVoices();
refresh();
initPiper();
geoCheck();

// Ask the browser to protect our storage from eviction (iOS clears "unused" site data
// after 7 days without this; installed PWAs plus persist() keep the learned model safe).
if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});

// Offline shell + installability.
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
