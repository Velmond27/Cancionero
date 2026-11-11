const DB_NAME = "mi-cancionero";
const DB_VERSION = 1;
const SONG_STORE = "songs";
const SETTINGS_STORE = "settings";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const state = {
  songs: [],
  customRepertoires: [],
  filter: "all",
  query: "",
  view: localStorage.getItem("song-view") || "grid",
  editingId: null,
  playingId: null,
  deferredInstall: null,
  scrolling: false,
  countdownTimer: null,
  animationFrame: null,
  scrollStartedAt: 0,
  scrollStartTop: 0,
  scrollDurationMs: 0,
};

let dbPromise;

function openDatabase() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SONG_STORE)) db.createObjectStore(SONG_STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) db.createObjectStore(SETTINGS_STORE, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function storeRequest(storeName, mode, callback) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    const request = callback(store);
    transaction.oncomplete = () => resolve(request?.result);
    transaction.onerror = () => reject(transaction.error);
  });
}

const getAllSongs = () => storeRequest(SONG_STORE, "readonly", (store) => store.getAll());
const putSong = (song) => storeRequest(SONG_STORE, "readwrite", (store) => store.put(song));
const removeSong = (id) => storeRequest(SONG_STORE, "readwrite", (store) => store.delete(id));
const getSetting = (key) => storeRequest(SETTINGS_STORE, "readonly", (store) => store.get(key));
const putSetting = (key, value) => storeRequest(SETTINGS_STORE, "readwrite", (store) => store.put({ key, value }));

function escapeHtml(value = "") {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function formatDuration(seconds = 0) {
  const safe = Math.max(0, Math.round(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

function normalize(value = "") {
  return value.toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove("show"), 2500);
}

function selectedSongs() {
  const query = normalize(state.query);
  return state.songs
    .filter((song) => {
      if (state.filter === "favorites" && !song.favorite) return false;
      if (!["all", "favorites"].includes(state.filter) && song.repertoire !== state.filter) return false;
      if (!query) return true;
      return normalize(`${song.title} ${song.artist} ${song.repertoire} ${song.lyrics}`).includes(query);
    })
    .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "") || a.title.localeCompare(b.title, "es"));
}

function allRepertoires() {
  return [...new Set([...state.customRepertoires, ...state.songs.map((song) => song.repertoire).filter(Boolean)])].sort((a, b) => a.localeCompare(b, "es"));
}

function renderRepertoires() {
  const repertoires = allRepertoires();
  $("#repertoireList").innerHTML = repertoires.map((name) => {
    const count = state.songs.filter((song) => song.repertoire === name).length;
    const indent = name.includes("/") ? " folder-indent" : "";
    return `<div class="repertoire-row">
      <button class="nav-item${state.filter === name ? " active" : ""}${indent}" data-folder="${escapeHtml(name)}" type="button"><span>${escapeHtml(name)}</span><b>${count}</b></button>
      <button class="delete-repertoire" data-delete-repertoire="${escapeHtml(name)}" type="button" aria-label="Eliminar repertorio ${escapeHtml(name)}" title="Eliminar repertorio">×</button>
    </div>`;
  }).join("");
  const select = $("#repertoireSelect");
  const selected = select.value;
  select.innerHTML = `<option value="">Sin repertorio</option>${repertoires.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("")}<option value="__new__">＋ Escribir uno nuevo…</option>`;
  if ([...select.options].some((option) => option.value === selected)) select.value = selected;
}

function render() {
  const songs = selectedSongs();
  $("#songCount").textContent = state.songs.length;
  $("#favoriteCount").textContent = state.songs.filter((song) => song.favorite).length;
  renderRepertoires();

  $$(".nav-item[data-folder]").forEach((button) => button.classList.toggle("active", button.dataset.folder === state.filter));
  $$(".view-switch button").forEach((button) => button.classList.toggle("active", button.dataset.view === state.view));
  $("#songGrid").classList.toggle("list-view", state.view === "list");

  let title = "Biblioteca";
  if (state.filter === "favorites") title = "Favoritas";
  else if (state.filter !== "all") title = state.filter;
  $("#libraryTitle").textContent = state.query ? `Resultados para “${state.query}”` : title;
  $("#librarySummary").textContent = `${songs.length} ${songs.length === 1 ? "canción" : "canciones"} disponibles sin conexión.`;

  $("#songGrid").innerHTML = songs.map((song) => `
    <button class="song-card" data-song-id="${song.id}" type="button">
      <span class="song-meta">${escapeHtml(song.repertoire || "Sin repertorio")}</span>
      <div>
        <h2>${escapeHtml(song.title)}</h2>
        <p class="song-artist">${escapeHtml(song.artist || "Artista sin especificar")}</p>
      </div>
      <div class="song-preview">${escapeHtml(song.lyrics.slice(0, 180))}</div>
      <div class="song-footer"><span>${formatDuration(song.durationSeconds)}</span><span class="star">${song.favorite ? "★" : "›"}</span></div>
    </button>
  `).join("");

  $("#emptyState").hidden = songs.length !== 0;
  $("#songGrid").hidden = songs.length === 0;
}

function openEditor(song = null) {
  state.editingId = song?.id || null;
  $("#editorTitle").textContent = song ? "Editar canción" : "Nueva canción";
  $("#titleInput").value = song?.title || "";
  $("#artistInput").value = song?.artist || "";
  const selectedRepertoire = song?.repertoire || (state.filter !== "all" && state.filter !== "favorites" ? state.filter : "");
  renderRepertoires();
  $("#repertoireSelect").value = selectedRepertoire;
  $("#repertoireInput").value = "";
  $("#repertoireInput").hidden = true;
  $("#minutesInput").value = Math.floor((song?.durationSeconds ?? 180) / 60);
  $("#secondsInput").value = (song?.durationSeconds ?? 180) % 60;
  $("#lyricsInput").value = song?.lyrics || "";
  $("#deleteSongButton").hidden = !song;
  $("#songEditor").showModal();
  setTimeout(() => $("#titleInput").focus(), 50);
}

function closeEditor() {
  $("#songEditor").close();
  state.editingId = null;
}

async function saveEditor(event) {
  event.preventDefault();
  const existing = state.songs.find((song) => song.id === state.editingId);
  const title = $("#titleInput").value.trim();
  if (!title) return $("#titleInput").focus();
  const selectedRepertoire = $("#repertoireSelect").value;
  const repertoire = selectedRepertoire === "__new__" ? $("#repertoireInput").value.trim() : selectedRepertoire;
  const song = {
    id: existing?.id || crypto.randomUUID(),
    title,
    artist: $("#artistInput").value.trim(),
    repertoire,
    durationSeconds: Math.max(1, (Number($("#minutesInput").value) || 0) * 60 + (Number($("#secondsInput").value) || 0)),
    lyrics: $("#lyricsInput").value.replace(/\r\n/g, "\n"),
    favorite: existing?.favorite || false,
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await putSong(song);
  if (repertoire && !state.customRepertoires.includes(repertoire)) {
    state.customRepertoires.push(repertoire);
    await putSetting("repertoires", state.customRepertoires);
  }
  state.songs = state.songs.filter((item) => item.id !== song.id).concat(song);
  closeEditor();
  render();
  toast("Canción guardada en este dispositivo");
}

function currentSong() {
  return state.songs.find((song) => song.id === state.playingId);
}

function openPerformance(song) {
  state.playingId = song.id;
  $("#performanceTitle").textContent = song.title;
  $("#performanceArtist").textContent = song.artist || song.repertoire || "";
  $("#performanceLyrics").textContent = song.lyrics || "(Esta canción todavía no tiene letra.)";
  $("#favoriteButton").textContent = song.favorite ? "★" : "☆";
  $("#timeRemaining").textContent = formatDuration(song.durationSeconds);
  $("#speedInput").value = "1";
  $("#speedOutput").textContent = "1×";
  $("#playButton").textContent = "▶";
  $("#lyricsScroller").scrollTop = 0;
  $("#performanceDialog").showModal();
}

function stopAutoscroll(reset = false) {
  state.scrolling = false;
  cancelAnimationFrame(state.animationFrame);
  clearInterval(state.countdownTimer);
  $("#countdown").hidden = true;
  $("#playButton").textContent = "▶";
  if (reset) {
    $("#lyricsScroller").scrollTop = 0;
    const song = currentSong();
    if (song) $("#timeRemaining").textContent = formatDuration(song.durationSeconds);
  }
}

function autoscrollFrame(now) {
  if (!state.scrolling) return;
  const scroller = $("#lyricsScroller");
  const speed = Number($("#speedInput").value);
  const elapsed = (now - state.scrollStartedAt) * speed;
  const progress = Math.min(1, elapsed / state.scrollDurationMs);
  const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  scroller.scrollTop = state.scrollStartTop + (maxScroll - state.scrollStartTop) * progress;
  const song = currentSong();
  if (song) $("#timeRemaining").textContent = formatDuration(Math.max(0, song.durationSeconds - elapsed / 1000));
  if (progress >= 1) return stopAutoscroll(false);
  state.animationFrame = requestAnimationFrame(autoscrollFrame);
}

function beginAutoscroll() {
  const song = currentSong();
  if (!song) return;
  state.scrolling = true;
  state.scrollStartTop = $("#lyricsScroller").scrollTop;
  state.scrollDurationMs = Math.max(1000, song.durationSeconds * 1000 * (1 - state.scrollStartTop / Math.max(1, $("#lyricsScroller").scrollHeight - $("#lyricsScroller").clientHeight)));
  state.scrollStartedAt = performance.now();
  $("#playButton").textContent = "Ⅱ";
  state.animationFrame = requestAnimationFrame(autoscrollFrame);
}

function toggleAutoscroll() {
  if (state.scrolling) return stopAutoscroll(false);
  if ($("#lyricsScroller").scrollTop > 5) return beginAutoscroll();
  let count = 3;
  $("#countdown").textContent = count;
  $("#countdown").hidden = false;
  state.countdownTimer = setInterval(() => {
    count -= 1;
    if (count === 0) {
      clearInterval(state.countdownTimer);
      $("#countdown").hidden = true;
      beginAutoscroll();
    } else {
      $("#countdown").textContent = count;
    }
  }, 700);
}

async function exportBackup() {
  const payload = { app: "Mi Cancionero", version: 1, exportedAt: new Date().toISOString(), repertoires: state.customRepertoires, songs: state.songs };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `mi-cancionero-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  toast("Respaldo exportado");
}

async function importBackup(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.songs)) throw new Error("Formato inválido");
    for (const song of data.songs) await putSong(song);
    state.customRepertoires = [...new Set([...(data.repertoires || []), ...state.customRepertoires])];
    await putSetting("repertoires", state.customRepertoires);
    state.songs = await getAllSongs();
    render();
    toast(`${data.songs.length} canciones importadas`);
  } catch {
    toast("No se pudo importar ese respaldo");
  }
}

function updateConnection() {
  const label = $("#connectionLabel");
  label.textContent = navigator.onLine ? "En línea · biblioteca offline" : "Sin conexión · lista para tocar";
  label.className = navigator.onLine ? "online" : "offline";
}

function setTheme(theme) {
  const selected = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = selected;
  localStorage.setItem("app-theme", selected);
  const button = $("#themeButton");
  if (!button) return;
  const nextIsLight = selected === "dark";
  button.textContent = nextIsLight ? "☀" : "☾";
  button.setAttribute("aria-label", nextIsLight ? "Cambiar a modo claro" : "Cambiar a modo oscuro");
  button.title = nextIsLight ? "Modo claro" : "Modo oscuro";
}

function bindEvents() {
  $("#newSongButton").addEventListener("click", () => openEditor());
  $("#emptyNewSongButton").addEventListener("click", () => openEditor());
  $("#closeEditorButton").addEventListener("click", closeEditor);
  $("#cancelEditorButton").addEventListener("click", closeEditor);
  $("#songForm").addEventListener("submit", saveEditor);
  $("#repertoireSelect").addEventListener("change", (event) => {
    const creating = event.target.value === "__new__";
    $("#repertoireInput").hidden = !creating;
    if (creating) setTimeout(() => $("#repertoireInput").focus(), 0);
  });

  $("#lyricsInput").addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    event.preventDefault();
    const input = event.currentTarget;
    input.setRangeText("    ", input.selectionStart, input.selectionEnd, "end");
  });
  $$('[data-insert]').forEach((button) => button.addEventListener("click", () => {
    const input = $("#lyricsInput");
    input.setRangeText(button.dataset.insert, input.selectionStart, input.selectionEnd, "end");
    input.focus();
  }));

  $("#deleteSongButton").addEventListener("click", async () => {
    const song = state.songs.find((item) => item.id === state.editingId);
    if (!song || !confirm(`¿Eliminar “${song.title}”? Esta acción no se puede deshacer.`)) return;
    await removeSong(song.id);
    state.songs = state.songs.filter((item) => item.id !== song.id);
    closeEditor();
    render();
    toast("Canción eliminada");
  });

  document.addEventListener("click", (event) => {
    const deleteRepertoireButton = event.target.closest("[data-delete-repertoire]");
    if (deleteRepertoireButton) {
      const name = deleteRepertoireButton.dataset.deleteRepertoire;
      const affected = state.songs.filter((song) => song.repertoire === name);
      const explanation = affected.length
        ? `Las ${affected.length} canciones se conservarán en “Sin repertorio”.`
        : "Este repertorio está vacío.";
      if (!confirm(`¿Eliminar el repertorio “${name}”?\n\n${explanation}`)) return;
      Promise.all(affected.map((song) => {
        song.repertoire = "";
        song.updatedAt = new Date().toISOString();
        return putSong(song);
      })).then(async () => {
        state.customRepertoires = state.customRepertoires.filter((item) => item !== name);
        await putSetting("repertoires", state.customRepertoires);
        if (state.filter === name) state.filter = "all";
        render();
        toast("Repertorio eliminado; las canciones se conservaron");
      });
      return;
    }
    const nav = event.target.closest(".nav-item[data-folder]");
    if (nav) {
      state.filter = nav.dataset.folder;
      state.query = "";
      $("#searchInput").value = "";
      $("#sidebar").classList.remove("open");
      render();
    }
    const card = event.target.closest(".song-card");
    if (card) openPerformance(state.songs.find((song) => song.id === card.dataset.songId));
  });

  $("#searchInput").addEventListener("input", (event) => { state.query = event.target.value.trim(); render(); });
  $$(".view-switch button").forEach((button) => button.addEventListener("click", () => {
    state.view = button.dataset.view;
    localStorage.setItem("song-view", state.view);
    render();
  }));
  $("#menuButton").addEventListener("click", () => $("#sidebar").classList.toggle("open"));
  $("#closeMenuButton").addEventListener("click", () => $("#sidebar").classList.remove("open"));
  $("#themeButton").addEventListener("click", () => {
    setTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light");
  });

  $("#webSearchButton").addEventListener("click", () => {
    if (!navigator.onLine) return toast("Conéctate a internet para buscar en la web");
    const query = $("#searchInput").value.trim() || prompt("¿Qué canción quieres buscar?");
    if (!query) return;
    window.open(`https://www.google.com/search?q=${encodeURIComponent(`${query} letra acordes`)}`, "_blank", "noopener,noreferrer");
  });

  $("#newRepertoireButton").addEventListener("click", () => $("#repertoireDialog").showModal());
  $("#cancelRepertoireButton").addEventListener("click", () => $("#repertoireDialog").close());
  $("#repertoireForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const value = $("#newRepertoireInput").value.trim();
    if (!value) return;
    state.customRepertoires = [...new Set([...state.customRepertoires, value])];
    await putSetting("repertoires", state.customRepertoires);
    $("#newRepertoireInput").value = "";
    $("#repertoireDialog").close();
    state.filter = value;
    render();
    openEditor();
  });

  $("#exportButton").addEventListener("click", exportBackup);
  $("#importInput").addEventListener("change", (event) => { if (event.target.files[0]) importBackup(event.target.files[0]); event.target.value = ""; });

  $("#closePerformanceButton").addEventListener("click", () => { stopAutoscroll(false); $("#performanceDialog").close(); });
  $("#playButton").addEventListener("click", toggleAutoscroll);
  $("#rewindButton").addEventListener("click", () => stopAutoscroll(true));
  $("#speedInput").addEventListener("input", (event) => { $("#speedOutput").textContent = `${Number(event.target.value).toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}×`; });
  $("#favoriteButton").addEventListener("click", async () => {
    const song = currentSong();
    if (!song) return;
    song.favorite = !song.favorite;
    song.updatedAt = new Date().toISOString();
    await putSong(song);
    $("#favoriteButton").textContent = song.favorite ? "★" : "☆";
    render();
  });
  $("#deleteFromPlayerButton").addEventListener("click", async () => {
    const song = currentSong();
    if (!song || !confirm(`¿Eliminar “${song.title}”? Esta acción no se puede deshacer.`)) return;
    stopAutoscroll(false);
    await removeSong(song.id);
    state.songs = state.songs.filter((item) => item.id !== song.id);
    state.playingId = null;
    $("#performanceDialog").close();
    render();
    toast("Canción eliminada");
  });
  $("#editFromPlayerButton").addEventListener("click", () => {
    const song = currentSong();
    stopAutoscroll(false);
    $("#performanceDialog").close();
    openEditor(song);
  });

  window.addEventListener("online", updateConnection);
  window.addEventListener("offline", updateConnection);
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.deferredInstall = event;
    $("#installButton").hidden = false;
  });
  $("#installButton").addEventListener("click", async () => {
    if (!state.deferredInstall) return;
    state.deferredInstall.prompt();
    await state.deferredInstall.userChoice;
    state.deferredInstall = null;
    $("#installButton").hidden = true;
  });
}

async function initialize() {
  const savedTheme = localStorage.getItem("app-theme");
  setTheme(savedTheme || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"));
  bindEvents();
  updateConnection();
  state.songs = await getAllSongs();
  state.customRepertoires = (await getSetting("repertoires"))?.value || [];
  render();
  if ("serviceWorker" in navigator) {
    try { await navigator.serviceWorker.register("./sw.js", { scope: "./" }); }
    catch (error) { console.warn("No se pudo registrar el modo offline", error); }
  }
}

initialize();
