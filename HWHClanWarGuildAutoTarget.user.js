// ==UserScript==
// @name         HWHClanWarGuildAutoTarget
// @name:ru      Авто-цели ВГ для гильдии
// @namespace    HWHClanWarGuildAutoTarget
// @version      4.44
// @description  Automatically assigns Clan War targets to all guild members based on past full victories (+20 points). Shows building names instead of slot numbers.
// @description:ru Автоматически назначает цели в Войне Гильдий всем членам гильдии по истории полных побед (+20 очков). В логах показывает названия зданий вместо номеров слотов.
// @author       emz13666
// @license      MIT
// @icon         data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiNmZmQyNGQiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cG9seWxpbmUgcG9pbnRzPSIxNC41IDE3LjUgMyA2IDMgMyA2IDMgMTcuNSAxNC41Ij48L3BvbHlsaW5lPjxsaW5lIHgxPSIxMyIgeTE9IjE5IiB4Mj0iMTkiIHkyPSIxMyI+PC9saW5lPjxsaW5lIHgxPSIxNiIgeTE9IjE2IiB4Mj0iMjAiIHkyPSIyMCI+PC9saW5lPjxsaW5lIHgxPSIxOSIgeTE9IjIxIiB4Mj0iMjEiIHkyPSIxOSI+PC9saW5lPjxwb2x5bGluZSBwb2ludHM9IjE0LjUgNi41IDE4IDMgMjEgMyAyMSA2IDE3LjUgOS41Ij48L3BvbHlsaW5lPjxsaW5lIHgxPSI1IiB5MT0iMTQiIHgyPSI5IiB5Mj0iMTgiPjwvbGluZT48bGluZSB4MT0iNyIgeTE9IjE3IiB4Mj0iMTEiIHkyPSIxMyI+PC9saW5lPjxsaW5lIHgxPSIzIiB5MT0iMTkiIHgyPSI1IiB5Mj0iMTciPjwvbGluZT48L3N2Zz4=
// @match        https://www.hero-wars.com/*
// @match        https://www.hero-wars.cn/*
// @match        https://apps-1701433570146040.apps.fbsbx.com/*
// @run-at       document-end
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/emz13666/HWHClanWarGuildAutoTarget/main/HWHClanWarGuildAutoTarget.user.js
// @updateURL    https://raw.githubusercontent.com/emz13666/HWHClanWarGuildAutoTarget/main/HWHClanWarGuildAutoTarget.user.js
// ==/UserScript==
(async function () {
'use strict';
const STORAGE_KEY = 'HWH_CW_History_Log_v1';
const REPLAY_CACHE_KEY = 'HWH_CW_Replay_Cache_v1';
const MAX_REPLAY_CACHE_ENTRIES = 3000;
const MAX_HISTORY_DAYS = 90;
const AUTO_CLOSE_DELAY_MS = 5000;
const DEBUG_MODE = true;
const LOCALSTORAGE_LIMIT_MB = 5;
const EXPORT_FORMAT_VERSION = 2;

/* ================================================================  /
/  🔥 ОЖИДАНИЕ ЗАГРУЗКИ HWH                                        /
/  ================================================================ */
async function waitForHelper(timeout = 60000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        if (globalThis.HWHClasses && globalThis.HWHFuncs && globalThis.HWHData && globalThis.Caller) {
            return true;
        }
        await new Promise(r => setTimeout(r, 500));
    }
    return false;
}
const found = await waitForHelper();
if (!found) {
    console.log('%c[HWHClanWarGuildAutoTarget] Объект расширения не найден', 'color: red');
    return;
}
console.log(`%cStart Extension ${GM_info.script.name}, v${GM_info.script.version} by ${GM_info.script.author}`, 'color: #ffd24d');
try {
    const { addExtentionName } = HWHFuncs;
    addExtentionName(GM_info.script.name, GM_info.script.version, GM_info.script.author);
} catch (e) {
    console.warn(' [HWHClanWarGuildAutoTarget] Не удалось зарегистрировать расширение в HWH:', e);
}

/* ================================================================  /
/  📊 ПРОВЕРКА ОБЪЁМА LOCALSTORAGE                                  /
/  ================================================================ */
function checkStorageSize() {
    try {
        let totalBytes = 0, historyBytes = 0, historyChars = 0, replayBytes = 0, replayChars = 0, replayCount = 0, keysCount = 0;
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            const value = localStorage.getItem(key) || '';
            const bytes = value.length * 2;
            totalBytes += bytes;
            keysCount++;
            if (key === STORAGE_KEY) { historyBytes = bytes; historyChars = value.length; }
            if (key === REPLAY_CACHE_KEY) {
                replayBytes = bytes; replayChars = value.length;
                try { replayCount = Object.keys(JSON.parse(value)).length; } catch (e) { replayCount = 0; }
            }
        }
        const limitBytes = LOCALSTORAGE_LIMIT_MB * 1024 * 1024;
        const freeBytes = Math.max(0, limitBytes - totalBytes);
        const formatBytes = (b) => {
            if (b < 1024) return b + ' Б';
            if (b < 1024 * 1024) return (b / 1024).toFixed(2) + ' КБ';
            return (b / (1024 * 1024)).toFixed(2) + ' МБ';
        };
        const percentUsed = ((totalBytes / limitBytes) * 100).toFixed(2);
        const historyPercent = historyBytes > 0 ? ((historyBytes / totalBytes) * 100).toFixed(2) : '0.00';
        const replayPercent = replayBytes > 0 ? ((replayBytes / totalBytes) * 100).toFixed(2) : '0.00';
        console.group(`%c[HWH CW Auto] 📊 Состояние localStorage`, 'color: #ffd24d; font-weight: bold');
        console.log(`%c🗄️ История ВГ (ключ "${STORAGE_KEY}"):`, 'color: #7fff7f');
        console.log(`• Символов : ${historyChars.toLocaleString('ru-RU')}`);
        console.log(`• Размер : ${formatBytes(historyBytes)}`);
        console.log(`• Доля : ${historyPercent}% от всего localStorage`);
        console.log(`%c📼 Кэш реплеев (ключ "${REPLAY_CACHE_KEY}"):`, 'color: #80d4ff');
        console.log(`• Записей : ${replayCount.toLocaleString('ru-RU')} (макс. ${MAX_REPLAY_CACHE_ENTRIES})`);
        console.log(`• Символов : ${replayChars.toLocaleString('ru-RU')}`);
        console.log(`• Размер : ${formatBytes(replayBytes)}`);
        console.log(`• Доля : ${replayPercent}% от всего localStorage`);
        console.log(`%c📦 Общий объём localStorage:`, 'color: #b8d4e3');
        console.log(`• Ключей : ${keysCount}`);
        console.log(`• Занято : ${formatBytes(totalBytes)} (${percentUsed}%)`);
        console.log(`• Свободно : ${formatBytes(freeBytes)} из ${formatBytes(limitBytes)}`);
        if (totalBytes / limitBytes > 0.8) {
            console.warn(`%c⚠️ Внимание: хранилище заполнено более чем на 80%!`, 'color: #ffd24d; font-weight: bold');
        }
        console.groupEnd();
    } catch (e) {
        console.error('[HWH CW Auto] Ошибка при проверке localStorage:', e);
    }
}
checkStorageSize();

/* ================================================================ /
/ 📼 КЭШ РЕПЛЕЕВ В LOCALSTORAGE                                   /
/ ================================================================ */
const replayMemoryCache = new Map();
let replayStorageCache = null;
let replayStorageDirty = false;

function loadReplayCache() {
    try {
        const data = localStorage.getItem(REPLAY_CACHE_KEY);
        return data ? JSON.parse(data) : {};
    } catch (e) {
        console.error('[HWH CW Auto] Ошибка загрузки кэша реплеев:', e);
        return {};
    }
}

function saveReplayCache(cache) {
    try {
        const keys = Object.keys(cache);
        if (keys.length > MAX_REPLAY_CACHE_ENTRIES) {
            const pruned = {};
            keys.slice(-MAX_REPLAY_CACHE_ENTRIES).forEach(k => pruned[k] = cache[k]);
            cache = pruned;
        }
        localStorage.setItem(REPLAY_CACHE_KEY, JSON.stringify(cache));
        return true;
    } catch (e) {
        console.error('[HWH CW Auto] Ошибка сохранения кэша реплеев:', e);
        return false;
    }
}

function getReplayStorageCache() {
    if (replayStorageCache === null) {
        replayStorageCache = loadReplayCache();
    }
    return replayStorageCache;
}

function reloadReplayCache() {
    replayStorageCache = loadReplayCache();
    replayMemoryCache.clear();
    for (const [k, v] of Object.entries(replayStorageCache)) {
        replayMemoryCache.set(k, v);
    }
    replayStorageDirty = false;
    logPanel(`🔄 Кэш реплеев перечитан в память: ${replayMemoryCache.size} записей`, 'info');
}

function flushReplayCache() {
    if (replayStorageDirty && replayStorageCache) {
        const success = saveReplayCache(replayStorageCache);
        if (success) {
            replayStorageDirty = false;
            const count = Object.keys(replayStorageCache).length;
            logPanel(`💾 Кэш реплеев сохранён: ${count} записей`, 'info');
        }
    }
}

/* ================================================================ /
/ 🗄️ РАБОТА С ЛОКАЛЬНОЙ БАЗОЙ ИСТОРИИ                            /
/ ================================================================ */
function loadHistory() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
    catch (e) { logPanel('Ошибка чтения истории, начинаем с нуля', 'warn'); return {}; }
}
function isEmptyBattle(battle) {
    if (!battle || typeof battle !== 'object') return true;
    const replayId = String(battle.replayId ?? '');
    return replayId === '0' || replayId === '';
}
function saveHistory(history) {
    try {
        const keys = Object.keys(history).sort().reverse();
        const pruned = {};
        let cleanedCount = 0;
        keys.slice(0, MAX_HISTORY_DAYS).forEach(k => {
            const cleanKey = k.trim();
            const battles = Array.isArray(history[k]) ? history[k] : [];
            const cleanBattles = battles.filter(b => !isEmptyBattle(b));
            if (cleanBattles.length < battles.length) cleanedCount += (battles.length - cleanBattles.length);
            if (cleanBattles.length > 0) {
                if (!pruned[cleanKey]) pruned[cleanKey] = [];
                pruned[cleanKey].push(...cleanBattles);
            }
        });
        for (const k in pruned) {
            const seen = new Set();
            pruned[k] = pruned[k].filter(b => {
                if (seen.has(b.replayId)) return false;
                seen.add(b.replayId);
                return true;
            });
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(pruned));
        let totalBattles = 0;
        for (const key of Object.keys(pruned)) totalBattles += pruned[key].length;
        if (cleanedCount > 0) logPanel(`🧹 При сохранении очищено ${cleanedCount} "пустых" боёв`, 'info');
        logPanel(`💾 База истории: ${Object.keys(pruned).length} дней (макс. ${MAX_HISTORY_DAYS}), ${totalBattles} битв`, 'info');
    } catch (e) {
        logPanel('Ошибка сохранения истории: ' + e.message, 'error');
    }
}
function isFullWin(battle) {
    if (!battle.win) return false;
    if (battle.slotPoints === undefined || battle.slotPoints === null) return true;
    return battle.slotPoints === 20;
}
function mergeAndSaveHistory(newData) {
    const history = loadHistory();
    let updated = false, newBattles = 0, skippedDuplicates = 0, skippedEmpty = 0, skippedEmptyDays = 0;
    for (const [key, battles] of Object.entries(newData)) {
        const validNewBattles = [];
        const existingReplays = new Set((history[key] || []).map(b => b.replayId));
        for (const battle of battles) {
            if (isEmptyBattle(battle)) { skippedEmpty++; continue; }
            if (existingReplays.has(battle.replayId)) { skippedDuplicates++; continue; }
            const newBattle = {
                attackerId: String(battle.attackerId),
                defenderId: String(battle.defenderId),
                replayId: battle.replayId,
                win: battle.win,
                slotPoints: battle.slotPoints,
                time: battle.time
            };
            if (Array.isArray(battle.defenderPacks) && battle.defenderPacks.length > 0) {
                newBattle.defenderPacks = battle.defenderPacks;
            }
            validNewBattles.push(newBattle);
            existingReplays.add(battle.replayId);
        }
        if (validNewBattles.length === 0) {
            if (!history[key] || history[key].length === 0) skippedEmptyDays++;
            continue;
        }
        if (!history[key]) history[key] = [];
        history[key].push(...validNewBattles);
        newBattles += validNewBattles.length;
        updated = true;
    }
    if (updated) saveHistory(history);
    if (newBattles > 0 || skippedDuplicates > 0 || skippedEmpty > 0) {
        let msg = `📥 Новых боёв: ${newBattles}`;
        if (skippedDuplicates > 0) msg += `, дубликатов: ${skippedDuplicates}`;
        if (skippedEmpty > 0) msg += `, пустых: ${skippedEmpty}`;
        if (skippedEmptyDays > 0) msg += `, пропущено пустых дней: ${skippedEmptyDays}`;
        logPanel(msg, 'info');
    }
    return history;
}

/* ================================================================ /
/ 💾 ЭКСПОРТ / 📂 ИМПОРТ (ИСТОРИЯ + КЭШ РЕПЛЕЕВ)                  /
/ ================================================================ */
function exportHistory() {
    try {
        const historyRaw = localStorage.getItem(STORAGE_KEY) || '{}';
        const replayRaw = localStorage.getItem(REPLAY_CACHE_KEY) || '{}';
        const historyParsed = JSON.parse(historyRaw);
        const replayParsed = JSON.parse(replayRaw);
        const historyDays = Object.keys(historyParsed).length;
        const replayCount = Object.keys(replayParsed).length;
        if (historyDays === 0 && replayCount === 0) {
            logPanel('⚠️ Оба хранилища пусты — нечего сохранять', 'warn');
            return;
        }
        const payload = {
            version: EXPORT_FORMAT_VERSION,
            exportedAt: new Date().toISOString(),
            scriptVersion: GM_info.script.version,
            history: historyParsed,
            replayCache: replayParsed
        };
        const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `hwh_cw_backup_${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        const sizeKB = (blob.size / 1024).toFixed(1);
        logPanel(`💾 Бэкап сохранён: история (${historyDays} дн.) + кэш (${replayCount} записей), ${sizeKB} КБ`, 'success');
    } catch (e) {
        logPanel('❌ Ошибка экспорта: ' + e.message, 'error');
    }
}

function importHistory() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';
    input.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) { input.remove(); return; }
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            if (typeof data !== 'object' || data === null || Array.isArray(data)) {
                throw new Error('Неверный формат: ожидается JSON-объект');
            }

            let historyData = null;
            let replayData = null;

            if (data.version === EXPORT_FORMAT_VERSION && (data.history || data.replayCache)) {
                if (data.history && (typeof data.history !== 'object' || Array.isArray(data.history))) {
                    throw new Error('Неверный формат поля "history"');
                }
                if (data.replayCache && (typeof data.replayCache !== 'object' || Array.isArray(data.replayCache))) {
                    throw new Error('Неверный формат поля "replayCache"');
                }
                historyData = data.history || null;
                replayData = data.replayCache || null;
                logPanel(`📂 Файл формата v${data.version} (от ${data.exportedAt || 'н/д'}), скрипт v${data.scriptVersion || 'н/д'}`, 'info');
            } else {
                let looksLikeHistory = false;
                for (const key of Object.keys(data)) {
                    if (Array.isArray(data[key])) { looksLikeHistory = true; break; }
                }
                if (looksLikeHistory) {
                    historyData = data;
                    logPanel('📂 Файл старого формата (только история)', 'info');
                } else {
                    throw new Error('Не удалось определить формат файла. Ожидается бэкап скрипта HWH CW Auto.');
                }
            }

            let historyMsg = '';
            if (historyData) {
                let validEntries = 0, skippedEmpty = 0;
                for (const [key, value] of Object.entries(historyData)) {
                    if (!Array.isArray(value)) throw new Error(`Неверный формат данных в ключе истории: ${key}`);
                    validEntries++;
                }
                const existing = loadHistory();
                const merged = { ...existing };
                for (const [key, battles] of Object.entries(historyData)) {
                    const validNewBattles = [];
                    const existingReplays = new Set((merged[key] || []).map(b => b.replayId));
                    for (const b of battles) {
                        if (isEmptyBattle(b)) { skippedEmpty++; continue; }
                        if (b && b.replayId && !existingReplays.has(b.replayId)) {
                            validNewBattles.push(b);
                            existingReplays.add(b.replayId);
                        }
                    }
                    if (validNewBattles.length === 0) continue;
                    if (!merged[key]) merged[key] = [];
                    merged[key].push(...validNewBattles);
                }
                saveHistory(merged);
                let totalBattles = 0;
                for (const key of Object.keys(merged)) totalBattles += merged[key].length;
                historyMsg = `история: ${validEntries} дн., ${totalBattles} битв`;
                if (skippedEmpty > 0) historyMsg += `, пропущено пустых: ${skippedEmpty}`;
            }

            let replayMsg = '';
            if (replayData) {
                const existingCache = getReplayStorageCache();
                let newCount = 0, skippedDuplicates = 0;
                for (const [replayId, value] of Object.entries(replayData)) {
                    if (!replayId || !value) { skippedDuplicates++; continue; }
                    if (existingCache[replayId]) { skippedDuplicates++; continue; }
                    existingCache[replayId] = value;
                    newCount++;
                }
                const saveOk = saveReplayCache(existingCache);
                if (saveOk) {
                    replayStorageCache = existingCache;
                    for (const [k, v] of Object.entries(replayData)) {
                        if (!replayMemoryCache.has(k)) replayMemoryCache.set(k, v);
                    }
                    replayMsg = `кэш реплеев: +${newCount} новых записей (всего ${Object.keys(existingCache).length})`;
                    if (skippedDuplicates > 0) replayMsg += `, дубликатов: ${skippedDuplicates}`;
                } else {
                    replayMsg = 'кэш реплеев: ошибка сохранения (возможно, переполнен localStorage)';
                }
            }

            const parts = [];
            if (historyMsg) parts.push(historyMsg);
            if (replayMsg) parts.push(replayMsg);
            if (parts.length === 0) {
                logPanel(`📂 Файл "${file.name}" импортирован, но новых данных не добавлено`, 'warn');
            } else {
                logPanel(`📂 Импортировано из "${file.name}": ${parts.join(' | ')}`, 'success');
            }
            checkStorageSize();
        } catch (err) {
            logPanel('❌ Ошибка импорта: ' + err.message, 'error');
        } finally {
            input.remove();
        }
    });
    document.body.appendChild(input);
    input.click();
}

/* ================================================================ /
/ 🖥️ ИНФОРМАЦИОННАЯ ПАНЕЛЬ                                       /
/ ================================================================ */
let panel = null, panelLog = null, panelProgress = null, panelTitle = null;
let panelMinimized = false, autoCloseTimer = null;
let altBtn = null;

function cancelAutoClose() {
    if (autoCloseTimer) {
        clearTimeout(autoCloseTimer);
        autoCloseTimer = null;
        logPanel('⏱️ Автозакрытие отменено (взаимодействие с панелью)', 'info');
    }
}
function createPanel() {
    if (panel) return;
    if (!document.getElementById('hwh-cw-panel-style')) {
        const style = document.createElement('style');
        style.id = 'hwh-cw-panel-style';
        style.textContent = `.hwh-cw-panel { position: fixed; top: 20px; right: 20px; width: 450px; max-height: 70vh; background: rgba(30, 25, 18, 0.95); border: 2px solid #8a6d3b; border-radius: 8px; color: #f3e3bd; font-family: Arial, sans-serif; font-size: 12px; z-index: 2147483000; box-shadow: 0 4px 20px rgba(0,0,0,0.5); display: flex; flex-direction: column; pointer-events: auto; } .hwh-cw-panel.minimized { max-height: 36px; overflow: hidden; } .hwh-cw-panel-header { display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; background: #3d2e1a; border-bottom: 1px solid #8a6d3b; border-radius: 6px 6px 0 0; cursor: move; user-select: none; } .hwh-cw-panel-title { font-weight: bold; font-size: 13px; color: #ffd24d; } .hwh-cw-panel-controls { display: flex; gap: 4px; } .hwh-cw-panel-btn { background: #5a4628; border: 1px solid #8a6d3b; color: #f3e3bd; width: 22px; height: 22px; border-radius: 3px; cursor: pointer; font-size: 12px; line-height: 1; padding: 0; } .hwh-cw-panel-btn:hover { background: #7a5f38; } .hwh-cw-panel-btn.close:hover { background: #a8322b; } .hwh-cw-panel-btn:disabled { opacity: 0.4; cursor: not-allowed; } .hwh-cw-panel-btn:disabled:hover { background: #5a4628; } .hwh-cw-panel-body { flex: 1; overflow-y: auto; padding: 8px; max-height: calc(70vh - 80px); } .hwh-cw-panel-progress { height: 6px; background: #1a140d; border-top: 1px solid #8a6d3b; border-bottom: 1px solid #8a6d3b; } .hwh-cw-panel-progress-bar { height: 100%; width: 0; background: linear-gradient(90deg, #3d8f2f, #5cb85c); transition: width 0.2s; } .hwh-cw-log-line { padding: 2px 4px; margin: 1px 0; border-radius: 2px; line-height: 1.3; word-wrap: break-word; } .hwh-cw-log-line.info { color: #b8d4e3; } .hwh-cw-log-line.success { color: #7fff7f; background: rgba(61, 143, 47, 0.15); } .hwh-cw-log-line.warn { color: #ffd24d; } .hwh-cw-log-line.error { color: #ff8a80; background: rgba(168, 50, 43, 0.15); } .hwh-cw-log-line.highlight { color: #fff; background: rgba(138, 109, 59, 0.3); font-weight: bold; } .hwh-cw-log-line.team-names { color: #ffd24d; font-style: italic; font-size: 11px; padding-left: 12px; } .hwh-cw-panel-body::-webkit-scrollbar { width: 6px; } .hwh-cw-panel-body::-webkit-scrollbar-track { background: #1a140d; } .hwh-cw-panel-body::-webkit-scrollbar-thumb { background: #8a6d3b; border-radius: 3px; }`;
        document.head.appendChild(style);
    }
    panel = document.createElement('div');
    panel.className = 'hwh-cw-panel';
    panel.addEventListener('mousedown', cancelAutoClose);
    panel.addEventListener('mouseenter', cancelAutoClose);
    const header = document.createElement('div');
    header.className = 'hwh-cw-panel-header';
    panelTitle = document.createElement('div');
    panelTitle.className = 'hwh-cw-panel-title';
    panelTitle.textContent = '🎯 Авто-цели ВГ';
    const controls = document.createElement('div');
    controls.className = 'hwh-cw-panel-controls';
    const exportBtn = document.createElement('button');
    exportBtn.className = 'hwh-cw-panel-btn';
    exportBtn.textContent = '💾';
    exportBtn.title = 'Сохранить в файл: история + кэш реплеев';
    exportBtn.addEventListener('click', (e) => { e.stopPropagation(); cancelAutoClose(); exportHistory(); });
    const importBtn = document.createElement('button');
    importBtn.className = 'hwh-cw-panel-btn';
    importBtn.textContent = '📂';
    importBtn.title = 'Загрузить из файла: история + кэш реплеев (с мержингом)';
    importBtn.addEventListener('click', (e) => { e.stopPropagation(); cancelAutoClose(); importHistory(); });
    altBtn = document.createElement('button');
    altBtn.className = 'hwh-cw-panel-btn';
    altBtn.textContent = '⚔️';
    altBtn.title = 'Альтернативные назначения (поиск + назначение по клику)';
    altBtn.disabled = true;
    const minBtn = document.createElement('button');
    minBtn.className = 'hwh-cw-panel-btn';
    minBtn.textContent = '—';
    minBtn.title = 'Свернуть/развернуть';
    minBtn.addEventListener('click', (e) => {
        e.stopPropagation(); cancelAutoClose();
        panelMinimized = !panelMinimized;
        panel.classList.toggle('minimized', panelMinimized);
        minBtn.textContent = panelMinimized ? '▢' : '—';
    });
    const closeBtn = document.createElement('button');
    closeBtn.className = 'hwh-cw-panel-btn close';
    closeBtn.textContent = '✕';
    closeBtn.title = 'Закрыть';
    closeBtn.addEventListener('click', (e) => { e.stopPropagation(); destroyPanel(); });
    controls.appendChild(exportBtn);
    controls.appendChild(importBtn);
    controls.appendChild(altBtn);
    controls.appendChild(minBtn);
    controls.appendChild(closeBtn);
    header.appendChild(panelTitle);
    header.appendChild(controls);
    const progress = document.createElement('div');
    progress.className = 'hwh-cw-panel-progress';
    panelProgress = document.createElement('div');
    panelProgress.className = 'hwh-cw-panel-progress-bar';
    progress.appendChild(panelProgress);
    panelLog = document.createElement('div');
    panelLog.className = 'hwh-cw-panel-body';
    panel.appendChild(header);
    panel.appendChild(progress);
    panel.appendChild(panelLog);
    document.body.appendChild(panel);
    makeDraggable(panel, header);
}
function destroyPanel() {
    cancelAutoClose();
    if (panel) { panel.remove(); panel = null; panelLog = null; panelProgress = null; panelTitle = null; altBtn = null; }
}
function makeDraggable(element, handle) {
    let offsetX = 0, offsetY = 0, isDragging = false;
    handle.addEventListener('mousedown', (e) => {
        if (e.target.tagName === 'BUTTON') return;
        cancelAutoClose();
        isDragging = true;
        offsetX = e.clientX - element.offsetLeft;
        offsetY = e.clientY - element.offsetTop;
        handle.style.cursor = 'grabbing';
        e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        element.style.left = Math.max(0, Math.min(window.innerWidth - element.offsetWidth, e.clientX - offsetX)) + 'px';
        element.style.top = Math.max(0, Math.min(window.innerHeight - element.offsetHeight, e.clientY - offsetY)) + 'px';
        element.style.right = 'auto';
    });
    document.addEventListener('mouseup', () => { isDragging = false; handle.style.cursor = 'move'; });
}
function logPanel(message, type = 'info') {
    const consoleMethod = type === 'error' ? console.error : type === 'warn' ? console.warn : console.log;
    consoleMethod(`[HWH CW Auto] ${message}`);
    if (!panelLog) createPanel();
    const line = document.createElement('div');
    line.className = `hwh-cw-log-line ${type}`;
    line.textContent = message;
    panelLog.appendChild(line);
    while (panelLog.children.length > 300) panelLog.removeChild(panelLog.firstChild);
    panelLog.scrollTop = panelLog.scrollHeight;
}
function logDebug(message, ...args) {
    if (!DEBUG_MODE) return;
    if (args.length > 0) {
        console.log(`[HWH CW Auto][DEBUG] ${message}`, ...args);
    } else {
        console.log(`%c[HWH CW Auto][DEBUG] ${message}`, 'color: #888; font-style: italic;');
    }
}
function logTeamNames(prefix, namesString) {
    if (!panelLog) createPanel();
    const line = document.createElement('div');
    line.className = 'hwh-cw-log-line team-names';
    line.textContent = `${prefix}${namesString}`;
    panelLog.appendChild(line);
    while (panelLog.children.length > 300) panelLog.removeChild(panelLog.firstChild);
    panelLog.scrollTop = panelLog.scrollHeight;
    console.log(`[HWH CW Auto] ${prefix}${namesString}`);
}
function setProgress(percent) {
    if (panelProgress) panelProgress.style.width = Math.max(0, Math.min(100, percent)) + '%';
}
function setPanelTitle(text) {
    if (panelTitle) panelTitle.textContent = text;
}
function scheduleAutoClose() {
    cancelAutoClose();
    logPanel(`⏱️ Панель закроется автоматически через ${AUTO_CLOSE_DELAY_MS / 1000} сек...`, 'info');
    autoCloseTimer = setTimeout(() => {
        if (panel) {
            console.log('[HWH CW Auto] ⏱️ Автозакрытие панели');
            destroyPanel();
        }
    }, AUTO_CLOSE_DELAY_MS);
}

/* ================================================================ /
/ 🔥 v4.21: ОПРЕДЕЛЕНИЕ ЗДАНИЯ ПО НОМЕРУ СЛОТА И ЛИГЕ            /
/ ================================================================ */
function getSlotLocation(slotId, league) {
    slotId = parseInt(slotId);
    let location = `Слот-${slotId}`;
    if (slotId >= 1 && slotId <= 2) location = `Ак.Магов-${slotId}`;
    else if (slotId >= 3 && slotId <= 4) location = `Маяк-${slotId - 2}`;
    else if (slotId >= 5 && slotId <= 6) location = `Казармы-${slotId - 4}`;
    else if (slotId >= 7 && slotId <= 9) location = `Мост-${slotId - 6}`;
    else if (slotId >= 10 && slotId <= 12) location = `Источник-${slotId - 9}`;
    else if (slotId >= 13 && slotId <= 15) location = `Литейная-${slotId - 12}`;
    else if (slotId >= 16 && slotId <= 18) location = `Врата-${slotId - 15}`;
    else if (slotId >= 19 && slotId <= 21) location = `Баст.Огня-${slotId - 18}`;
    else if (slotId >= 22 && slotId <= 24) location = `Баст.Льда-${slotId - 21}`;
    else if (slotId >= 25 && slotId <= 30) location = `Цитадель-${slotId - 24}`;
    if (slotId >= 31 && slotId <= 40) {
        switch (slotId) {
            case 31: location = `Ак.Магов-3`; break;
            case 32: location = `Маяк-3`; break;
            case 33: location = `Казармы-3`; break;
            case 34: location = `Мост-4`; break;
            case 35: location = `Источник-4`; break;
            case 36: location = `Литейная-4`; break;
            case 37: location = `Врата-4`; break;
            case 38: location = `Баст.Огня-4`; break;
            case 39: location = `Баст.Льда-4`; break;
            case 40: location = `Цитадель-7`; break;
        }
    }
    return `${location} (#${slotId})`;
}

/* ================================================================  /
/  🔥 ПЕРЕВОД ID ГЕРОЕВ/ТИТАНОВ/ПИТОМЦЕВ В ИМЕНА                   /
/  ================================================================ */
const heroNameCache = new Map();
function getHeroName(heroId) {
    if (!heroId) return '?';
    const id = String(heroId);
    if (heroNameCache.has(id)) return heroNameCache.get(id);
    let name = null;
    try {
        if (typeof cheats !== 'undefined' && typeof cheats.translate === 'function') {
            const translated = cheats.translate(`LIB_HERO_NAME_${id}`);
            if (translated && !translated.startsWith('LIB_HERO_NAME_')) name = translated;
        }
    } catch (e) { /* ignore */ }
    if (!name) {
        try {
            if (typeof lib !== 'undefined' && lib.data?.hero?.[id]) {
                const heroData = lib.data.hero[id];
                if (typeof cheats !== 'undefined' && typeof cheats.translate === 'function') {
                    const translated = cheats.translate(heroData.name || `LIB_HERO_NAME_${id}`);
                    if (translated && !translated.startsWith('LIB_HERO_NAME_')) name = translated;
                }
            }
        } catch (e) { /* ignore */ }
    }
    if (!name) name = `ID:${id}`;
    heroNameCache.set(id, name);
    return name;
}
function getTeamNamesString(team) {
    if (!team) return '';
    let units = [];
    if (Array.isArray(team)) units = team.map(h => ({ id: h.id, petId: h.petId })).filter(u => u.id);
    else if (typeof team === 'object') units = Object.values(team).map(h => ({ id: h.id, petId: h.petId })).filter(u => u.id);
    if (units.length === 0) return '';
    units.sort((a, b) => a.id - b.id);
    return units.map(u => {
        const name = getHeroName(u.id);
        if (u.petId) return `${name} (${getHeroName(u.petId)})`;
        return name;
    }).join(', ');
}

/* ================================================================ /
/ ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ                                           /
/ ================================================================ */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function getTeamSignature(team) {
    if (!team) return '';
    let heroes = [];
    if (Array.isArray(team)) heroes = team.map(h => h.id);
    else if (typeof team === 'object') heroes = Object.values(team).map(h => h.id);
    return heroes.filter(id => id).sort((a, b) => a - b).join(',');
}
function getTeamType(teamObj) {
    if (!teamObj) return null;
    let firstUnit = null;
    if (Array.isArray(teamObj)) firstUnit = teamObj[0];
    else if (typeof teamObj === 'object') {
        const keys = Object.keys(teamObj);
        if (keys.length > 0) firstUnit = teamObj[keys[0]];
    }
    if (firstUnit && firstUnit.type) return firstUnit.type;
    return null;
}

/* ================================================================ /
/ 📼 ЗАГРУЗКА РЕПЛЕЯ С ТРЁХУРОВНЕВЫМ КЭШЕМ                        /
/ ================================================================ */
async function getReplayInfo(replayId) {
    if (replayMemoryCache.has(replayId)) return replayMemoryCache.get(replayId);

    const storageCache = getReplayStorageCache();
    if (storageCache[replayId]) {
        const cached = storageCache[replayId];
        replayMemoryCache.set(replayId, cached);
        logDebug(`📼 Реплей ${replayId}: взят из кэша localStorage`);
        return cached;
    }

    try {
        const replay = await Caller.send({ name: 'battleGetReplay', args: { id: replayId } });
        const result = { attackers: [], defenders: [] };
        const pastAttackers = replay?.replay?.attackers;
        if (pastAttackers) {
            let attackerList = [];
            if (Array.isArray(pastAttackers)) attackerList = pastAttackers;
            else if (typeof pastAttackers === 'object') attackerList = Object.values(pastAttackers);
            if (attackerList.length > 0) {
                const teamString = getTeamSignature(attackerList);
                const teamNames = getTeamNamesString(attackerList);
                if (teamString) result.attackers.push({ teamString, teamNames });
            }
        }
        const pastDefenders = replay?.replay?.defenders;
        if (pastDefenders && pastDefenders.length > 0) {
            for (const defTeam of pastDefenders) {
                const teamString = getTeamSignature(defTeam);
                const teamType = getTeamType(defTeam);
                const teamNames = getTeamNamesString(defTeam);
                if (teamString && teamType) result.defenders.push({ teamString, teamType, teamNames });
            }
        }
        replayMemoryCache.set(replayId, result);
        storageCache[replayId] = result;
        replayStorageDirty = true;
        logDebug(`📼 Реплей ${replayId}: загружен с сервера и сохранён в кэш`);
        for (const d of result.defenders) {
            logDebug(`   🛡️ [${d.teamType}] пачка=[${d.teamString}] → ${d.teamNames}`);
        }
        return result;
    } catch (e) {
        logPanel(`Не удалось загрузить реплей ${replayId}`, 'warn');
        return { attackers: [], defenders: [] };
    }
}

/* ================================================================ /
/ 🔥 v4.40: ПОСТРОЕНИЕ ИНДЕКСА ПАЧЕК (с обогащением и кэшем)     /
/ ================================================================ */
async function buildPackIndex(mergedHistory, maxNew = 300) {
    const idx = new Map();
    let newLoads = 0, fromStorage = 0, skippedNoData = 0, enrichedCount = 0;
    let totalFullWins = 0;
    for (const battles of Object.values(mergedHistory)) {
        for (const b of battles) {
            if (isFullWin(b) && !isEmptyBattle(b)) totalFullWins++;
        }
    }
    logPanel(`🔍 Анализ ${totalFullWins} побед для поиска альтернатив...`, 'info');
    let lastProgressPct = 0;
    for (const battles of Object.values(mergedHistory)) {
        for (const b of battles) {
            if (!isFullWin(b) || isEmptyBattle(b)) continue;
            let defenders = [];
            if (Array.isArray(b.defenderPacks) && b.defenderPacks.length > 0) {
                defenders = b.defenderPacks;
                fromStorage++;
            } else {
                if (newLoads >= maxNew) { skippedNoData++; continue; }
                if (newLoads % 10 === 0) {
                    const pct = Math.round((newLoads / Math.max(1, Math.min(totalFullWins, maxNew))) * 100);
                    if (pct > lastProgressPct) {
                        logPanel(`🔍 Загрузка реплеев: ${newLoads}...`, 'info');
                        setProgress(94 + Math.min(4, pct * 0.04));
                        lastProgressPct = pct;
                    }
                }
                const ri = await getReplayInfo(b.replayId);
                defenders = ri.defenders;
                newLoads++;
                if (defenders.length > 0) {
                    b.defenderPacks = defenders.map(d => ({
                        teamType: d.teamType,
                        teamString: d.teamString
                    }));
                    enrichedCount++;
                }
                await sleep(100);
            }
            for (const d of defenders) {
                const pk = d.teamType + '|' + d.teamString;
                if (!idx.has(pk)) idx.set(pk, new Map());
                const am = idx.get(pk);
                if (!am.has(b.attackerId)) am.set(b.attackerId, 0);
                am.set(b.attackerId, am.get(b.attackerId) + 1);
            }
        }
    }
    let msg = `🔍 Индекс пачек: ${idx.size} уникальных (из базы: ${fromStorage}, загружено: ${newLoads}`;
    if (skippedNoData > 0) msg += `, пропущено: ${skippedNoData}`;
    msg += ')';
    logPanel(msg, 'info');
    return { idx, enrichedCount };
}

/* ================================================================ /
/ 🔥 v4.43: ПОИСК АЛЬТЕРНАТИВНЫХ НАЗНАЧЕНИЙ                       /
/ Учитывает уже занятые попытки (available вместо total)          /
/ ================================================================ */
function findAlternatives(allSlots, packIndex, guildMembers, usedTries, alreadyAttackedToday, memberNames) {
    const alts = new Map();
    for (const slot of allSlots) {
        const pk = slot.teamType + '|' + slot.teamString;
        const am = packIndex.get(pk);
        if (!am || am.size === 0) continue;
        const all = [], filtered = [];
        for (const [atkId, wins] of am) {
            const member = guildMembers.find(m => m.id === atkId);
            if (!member) continue;
            
            const available = member.available;
            const usedInThisRun = usedTries.get(atkId) || 0;
            const left = available - usedInThisRun;
            const name = memberNames[atkId] || atkId;
            
            all.push({ attackerId: atkId, attackerName: name, winsCount: wins, triesLeft: left });
            
            // Исключаем, если не осталось попыток или игрок уже на этом слоте
            if (left <= 0 || slot.assignedAttackerId === atkId || alreadyAttackedToday.has(slot.defenderId)) continue;
            filtered.push({ attackerId: atkId, attackerName: name, winsCount: wins, triesLeft: left });
        }
        filtered.sort((a, b) => b.winsCount !== a.winsCount ? b.winsCount - a.winsCount : b.triesLeft - a.triesLeft);
        alts.set(slot.slotId, { slotInfo: slot, allCount: all.length, topList: filtered.slice(0, 5), isAssigned: slot.assignedAttackerId !== null });
    }
    return alts;
}
function logAlternatives(alternatives, assigned) {
    for (const a of assigned) {
        const alt = alternatives.get(a.slotId);
        if (!alt || alt.topList.length === 0) continue;
        logPanel(`🔄 Альтернативы для ${a.slotLocation} (${a.defenderName}) (всего ${alt.allCount}):`, 'info');
        for (const c of alt.topList) {
            logPanel(`• ${c.attackerName} (${c.winsCount} побед, ${c.triesLeft} попыт.)`, 'info');
        }
    }
    const freeAlts = [...alternatives.entries()]
        .filter(([, d]) => !d.isAssigned && d.topList.length > 0)
        .sort((a, b) => b[1].allCount - a[1].allCount);
    if (freeAlts.length > 0) {
        logPanel('━'.repeat(30), 'info');
        logPanel('🔄 Свободные слоты с альтернативами:', 'highlight');
        for (const [, d] of freeAlts) {
            logPanel(`• ${d.slotInfo.slotLocation}: ${d.slotInfo.defenderName} (всего ${d.allCount}):`, 'warn');
            for (const c of d.topList) {
                logPanel(`• ${c.attackerName} (${c.winsCount} побед, ${c.triesLeft} попыт.)`, 'warn');
            }
        }
    }
}

/* ================================================================  /
/  🔥 v4.43: НАЗНАЧЕНИЕ АЛЬТЕРНАТИВНЫХ ЦЕЛЕЙ                       /
/  Проверяет available - used, а не просто used                    /
/  ================================================================ */
async function assignAlternatives(alternatives, guildMembers, usedTries, alreadyAttackedToday) {
    cancelAutoClose();
    const freeAlts = [...alternatives.entries()]
        .filter(([, d]) => !d.isAssigned && d.topList.length > 0)
        .sort((a, b) => b[1].allCount - a[1].allCount);
    if (freeAlts.length === 0) { logPanel('⚠️ Нет свободных слотов с альтернативами', 'warn'); return; }
    let count = 0;
    const altUsed = new Map(usedTries); 
    setPanelTitle('⚔️ Альт-назначения...');
    setProgress(0);
    for (let i = 0; i < freeAlts.length; i++) {
        const [slotId, d] = freeAlts[i];
        setProgress((i / freeAlts.length) * 100);
        for (const alt of d.topList) {
            const member = guildMembers.find(m => m.id === alt.attackerId);
            if (!member) continue;
            
            const available = member.available;
            const used = altUsed.get(alt.attackerId) || 0;
            
            if (available - used <= 0) continue;
            
            try {
                const r = await Caller.send({ name: 'clanWarSetTargetMark', args: { userId: alt.attackerId, slotId } });
                if (r === null || r === undefined || !r.error) {
                    count++;
                    altUsed.set(alt.attackerId, used + 1);
                    logPanel(`✅ Альт: ${alt.attackerName} → ${d.slotInfo.slotLocation}: ${d.slotInfo.defenderName} (попытка ${used + 1}/${available})`, 'success');
                    break;
                } else {
                    logPanel(`❌ Ошибка сервера: ${JSON.stringify(r)}`, 'error');
                }
            } catch (e) { logPanel(`❌ Ошибка: ${e.message}`, 'error'); }
            await sleep(150);
        }
    }
    setProgress(100);
    logPanel('━'.repeat(30), 'info');
    logPanel(`🔄 Альтернативно назначено: ${count} целей`, 'highlight');
    setPanelTitle(`⚔️ Готово: ${count} альт-назначений`);
    if (altBtn) altBtn.disabled = true;
    checkStorageSize();
    scheduleAutoClose();
}

/* ================================================================  /
/  🔥 v4.43: ПОИСК И НАЗНАЧЕНИЕ АЛЬТЕРНАТИВ ПО КЛИКУ КНОПКИ        /
/  ================================================================ */
async function findAndAssignAlternatives(allSlots, assigned, guildMembers, usedTries, alreadyAttackedToday, memberNames, mergedHistory) {
    try {
        setPanelTitle('🔍 Поиск альтернатив...');
        setProgress(0);
        if (altBtn) altBtn.disabled = true;
        logPanel('━'.repeat(30), 'info');
        logPanel('🔍 Запуск поиска альтернативных назначений...', 'highlight');

        const { idx: packIndex, enrichedCount } = await buildPackIndex(mergedHistory);

        if (enrichedCount > 0) {
            saveHistory(mergedHistory);
            flushReplayCache();
            logPanel(`💾 История обогащена (+${enrichedCount} записей), кэш реплеев обновлён`, 'info');
        } else {
            flushReplayCache();
        }

        const alternatives = findAlternatives(allSlots, packIndex, guildMembers, usedTries, alreadyAttackedToday, memberNames);
        logAlternatives(alternatives, assigned);

        const hasFreeAlts = [...alternatives.values()].some(d => !d.isAssigned && d.topList.length > 0);

        if (hasFreeAlts) {
            logPanel('━'.repeat(30), 'info');
            logPanel('⚔️ Начинаем альтернативные назначения...', 'highlight');
            await assignAlternatives(alternatives, guildMembers, usedTries, alreadyAttackedToday);
        } else {
            logPanel('⚠️ Альтернатив для назначения не найдено', 'warn');
            setPanelTitle('⚔️ Альтернатив не найдено');
            scheduleAutoClose();
        }
    } catch (error) {
        logPanel(`💥 Ошибка при поиске альтернатив: ${error.message}`, 'error');
        setPanelTitle('⚔️ Ошибка');
        if (altBtn) altBtn.disabled = false;
    }
}

/* ================================================================  /
/  ОСНОВНАЯ ЛОГИКА                                                 /
/  ================================================================ */
async function autoAssignGuildTargets() {
    createPanel();
    panelLog.innerHTML = '';
    cancelAutoClose();
    setPanelTitle(`🎯 Авто-цели ВГ v${GM_info.script.version}: запуск...`);
    setProgress(0);
    if (altBtn) { altBtn.disabled = true; altBtn.onclick = null; }
    if (DEBUG_MODE) logDebug('🔧 DEBUG_MODE включён. Расширенные логи выводятся в консоль (F12).');

    try {
        if (typeof Caller === 'undefined' || typeof Caller.send === 'undefined') {
            logPanel('⚠️ HeroWarsHelper (Caller) не найден.', 'error');
            scheduleAutoClose();
            return;
        }

        logPanel('📜 Обновление базы истории боёв...', 'info');
        setProgress(5);
        let mergedHistory = loadHistory();
        let historyKeys = Object.keys(mergedHistory).sort().reverse();
        try {
            const historyList = await Caller.send('clanWarGetAvailableHistory');
            if (historyList?.history?.length) {
                const newDataToMerge = {};
                let loadedDays = 0;
                for (const hist of historyList.history) {
                    try {
                        const dayHistory = await Caller.send({
                            name: 'clanWarGetDayHistory',
                            args: { season: parseInt(hist.season), day: parseInt(hist.day) }
                        });
                        if (dayHistory?.attack) newDataToMerge[`${hist.season}_${hist.day}`] = dayHistory.attack;
                        loadedDays++;
                        setProgress(5 + (loadedDays / historyList.history.length) * 25);
                        await sleep(100);
                    } catch (e) {
                        logPanel(`Не удалось загрузить день ${hist.season}_${hist.day}`, 'warn');
                    }
                }
                mergedHistory = mergeAndSaveHistory(newDataToMerge);
                historyKeys = Object.keys(mergedHistory).sort().reverse();
            } else {
                logPanel('⚠️ История боёв от сервера пуста.', 'warn');
            }
        } catch (e) {
            logPanel('⚠️ Не удалось загрузить историю: ' + e.message, 'warn');
        }
        let totalBattles = 0, totalFullWins = 0;
        for (const key of historyKeys) {
            for (const b of (mergedHistory[key] || [])) {
                totalBattles++;
                if (isFullWin(b)) totalFullWins++;
            }
        }
        logPanel(`📚 В базе ${historyKeys.length} дней, ${totalBattles} боёв (${totalFullWins} полных побед)`, 'info');

        logPanel('📡 Запрос clanWarGetInfo...', 'info');
        setProgress(32);
        const cwInfo = await Caller.send('clanWarGetInfo');
        if (!cwInfo || !cwInfo.enemySlots) {
            logPanel('⚠️ Война Гильдий не активна. База истории обновлена.', 'warn');
            checkStorageSize();
            scheduleAutoClose();
            return;
        }

        const enemySlots = cwInfo.enemySlots;
        const clanTries = cwInfo.clanTries || {};
        const currentSeason = cwInfo.season;
        const currentDay = cwInfo.day;
        const league = cwInfo.league || 1;
        const memberNames = {};
        if (cwInfo.ourSlots) for (const s of Object.values(cwInfo.ourSlots)) if (s.user) memberNames[s.user.id] = s.user.name;
        if (cwInfo.ourClanMembers) for (const m of Object.values(cwInfo.ourClanMembers)) memberNames[m.id] = m.name;
        if (cwInfo.enemyClanMembers) for (const m of Object.values(cwInfo.enemyClanMembers)) memberNames[m.id] = m.name;
        for (const s of Object.values(enemySlots)) if (s.user) memberNames[s.user.id] = s.user.name;
        logPanel(`📊 Сезон/День: ${currentSeason}/${currentDay}, Лига: ${league == 1 ? 'Золотая' : 'Серебряная'}, попытки: ${cwInfo.myTries}`, 'info');

        /* ============================================================ */
        /* 🔥 v4.44: ПОДСЧЁТ УЖЕ ЗАНЯТЫХ ПОПЫТОК ДО ЗАПУСКА СКРИПТА   */
        /* ============================================================ */
        const preAssignedTries = new Map();
        for (const slotData of Object.values(enemySlots)) {
            // 🔥 Исправлено! Игра использует targetMarkingUserId для отметки цели,
            // а attackerId может быть 0 до начала/завершения боя. Проверяем оба поля.
            const markerId = String(slotData.targetMarkingUserId || slotData.attackerId || "0");
            if (markerId !== "0" && markerId !== "null" && markerId !== "undefined") {
                preAssignedTries.set(markerId, (preAssignedTries.get(markerId) || 0) + 1);
            }
        }

        const guildMembers = [];
        let totalTries = 0;
        for (const userId of Object.keys(clanTries)) {
            if (userId === "clan") continue;
            const total = parseInt(clanTries[userId]);
            const alreadyUsed = preAssignedTries.get(userId) || 0;
            const available = Math.max(0, total - alreadyUsed);

            guildMembers.push({
                id: userId,
                total: total,
                available: available,
                alreadyUsed: alreadyUsed
            });

            if (available > 0) {
                totalTries += available;
                logPanel(`👤 ${memberNames[userId] || userId}: попыток = ${available} (всего ${total}, занято: ${alreadyUsed})`, 'info');
            } else if (total > 0) {
                logPanel(`👤 ${memberNames[userId] || userId}: попыток = 0 (все ${total} уже заняты)`, 'warn');
            }
        }
        
        // Сортируем: сначала те, у кого есть свободные попытки
        guildMembers.sort((a, b) => b.available - a.available);
        logPanel(`✅ ${guildMembers.filter(m => m.available > 0).length} членов гильдии со свободными попытками, всего ${totalTries} попыток`, 'success');

        const enemyUserIds = new Set();
        for (const slot of Object.values(enemySlots)) {
            if (slot.user?.id) enemyUserIds.add(String(slot.user.id));
        }
        logPanel(`👥 ${enemyUserIds.size} вражеских игроков в текущей войне`, 'info');

        let totalWinsVsCurrentGuild = 0;
        for (const key of historyKeys) {
            for (const b of (mergedHistory[key] || [])) {
                if (isFullWin(b) && enemyUserIds.has(b.defenderId)) totalWinsVsCurrentGuild++;
            }
        }
        logPanel(`📚 Полных побед в базе против текущей гильдии: ${totalWinsVsCurrentGuild}. Ищем цели...`, 'highlight');

        logPanel('🛡️ Проверка журнала текущего дня...', 'info');
        const alreadyAttackedToday = new Set();
        try {
            const currentDayHistory = await Caller.send({
                name: 'clanWarGetDayHistory',
                args: { season: parseInt(currentSeason), day: parseInt(currentDay) }
            });
            if (currentDayHistory?.attack) {
                for (const battle of currentDayHistory.attack) {
                    const defId = String(battle.defenderId);
                    const slotId = battle.slotId;
                    if (enemyUserIds.has(defId)) {
                        const attackKey = slotId ? `${defId}_${slotId}` : defId;
                        alreadyAttackedToday.add(attackKey);
                        const defName = memberNames[defId] || defId;
                        const atkName = memberNames[String(battle.attackerId)] || battle.attackerId;
                        const slotInfo = slotId ? ` (слот ${slotId})` : '';
                        logPanel(`🛡️ ${defName}${slotInfo}: атакован сегодня (${atkName})`, 'warn');
                    }
                }
            }
        } catch (e) {
            logPanel('Не удалось получить историю текущего дня: ' + e.message, 'warn');
        }
        logPanel(`🛡️ Итого атакованы сегодня: ${alreadyAttackedToday.size} противников`, 'info');

        const freeSlots = new Map();
        const allSlots = [];
        const skippedSlots = [];
        for (const [slotId, slotData] of Object.entries(enemySlots)) {
            const defenderId = slotData.user?.id ? String(slotData.user.id) : null;
            if (!defenderId) continue;
            const defenderName = slotData.user?.name || 'N/A';
            const isMarkFree = !slotData.targetMarkingUserId || String(slotData.targetMarkingUserId) === "0";
            const isAttackerFree = !slotData.attackerId || String(slotData.attackerId) === "0";
            const isReady = slotData.status === "ready";
            const attackKey = `${defenderId}_${slotId}`;
            const isNotAttackedToday = !alreadyAttackedToday.has(attackKey) && !alreadyAttackedToday.has(defenderId);
            const isFree = isMarkFree && isAttackerFree && isReady && isNotAttackedToday;
            if (isFree) {
                const teamObj = slotData.team?.[0] || {};
                const teamString = getTeamSignature(teamObj);
                const teamType = getTeamType(teamObj);
                const teamNames = getTeamNamesString(teamObj);
                const slotLocation = getSlotLocation(slotId, league);
                const slotInfo = {
                    slotId: parseInt(slotId),
                    defenderId,
                    teamString,
                    teamType,
                    defenderName,
                    teamNames,
                    slotLocation,
                    assignedAttackerId: null
                };
                freeSlots.set(parseInt(slotId), slotInfo);
                allSlots.push(slotInfo);
                logDebug(`✅ Свободный слот ${slotLocation} (${defenderName}): тип=${teamType}, пачка=[${teamString}]`);
            } else {
                const reasons = [];
                if (!isMarkFree) reasons.push(`targetMark=${slotData.targetMarkingUserId}`);
                if (!isAttackerFree) reasons.push(`attacker=${slotData.attackerId}`);
                if (!isReady) reasons.push(`status=${slotData.status}`);
                if (!isNotAttackedToday) reasons.push(`атакован сегодня`);
                skippedSlots.push({ slotId, defenderId, defenderName, reasons });
                logDebug(`⏭️ Слот ${getSlotLocation(slotId, league)} (${defenderName}) пропущен: ${reasons.join(', ')}`);
            }
        }
        logPanel(`🎯 ${freeSlots.size} свободных слотов (пропущено ${skippedSlots.length})`, 'info');
        if (skippedSlots.length > 0) {
            logPanel('⏭️ Пропущенные слоты:', 'warn');
            for (const s of skippedSlots) {
                logPanel(`  • ${getSlotLocation(s.slotId, league)} ${s.defenderName}: ${s.reasons.join(', ')}`, 'warn');
            }
        }
        if (guildMembers.filter(m => m.available > 0).length === 0) {
            logPanel('⚠️ Нет попыток для атаки.', 'warn');
            checkStorageSize();
            scheduleAutoClose();
            return;
        }
        if (freeSlots.size === 0) {
            logPanel('⚠️ Нет свободных слотов.', 'warn');
            checkStorageSize();
            scheduleAutoClose();
            return;
        }

        const assigned = [];
        const skipped = [];
        let historyEnriched = false;

        for (let mi = 0; mi < guildMembers.length; mi++) {
            const member = guildMembers[mi];
            
            // Пропускаем тех, у кого не осталось попыток
            if (member.available <= 0) continue;

            const memberName = memberNames[member.id] || member.id;
            setPanelTitle(`🎯 ${memberName} [${member.available} своб. попыт.]`);
            setProgress(35 + ((mi / guildMembers.length) * 55));
            
            if (freeSlots.size === 0) {
                skipped.push(`${memberName}: нет свободных слотов`);
                break;
            }
            
            const defendersWithWins = new Set();
            for (const key of historyKeys) {
                const battles = mergedHistory[key] || [];
                for (const b of battles) {
                    if (b.attackerId === member.id && isFullWin(b)) {
                        defendersWithWins.add(b.defenderId);
                    }
                }
            }
            if (defendersWithWins.size > 0) {
                const namesList = [...defendersWithWins].map(id => memberNames[id] || id).join(', ');
                logPanel(`📚 ${memberName} (${member.available} попыт.): победы в базе против: ${namesList}`, 'info');
            } else {
                logPanel(`📚 ${memberName} (${member.available} попыт.): побед в базе НЕТ`, 'warn');
            }
            
            let foundCount = 0;
            const foundDefenderSlots = new Set();
            for (const key of historyKeys) {
                if (foundCount >= member.available) break;
                if (freeSlots.size === 0) break;
                const battles = mergedHistory[key];
                if (!battles) continue;
                const memberWins = battles.filter(b => b.attackerId === member.id && isFullWin(b));
                if (memberWins.length === 0) continue;
                logDebug(`📖 ${memberName}: ${memberWins.length} побед (день ${key})`);
                for (let i = memberWins.length - 1; i >= 0; i--) {
                    if (foundCount >= member.available) break;
                    if (freeSlots.size === 0) break;
                    const win = memberWins[i];
                    const defenderId = win.defenderId;
                    if (foundDefenderSlots.has(defenderId)) {
                        logDebug(`⏭️ ${memberName}: защитник ${memberNames[defenderId] || defenderId} уже назначен ранее в этом запуске`);
                        continue;
                    }
                    const replayInfo = await getReplayInfo(win.replayId);
                    if (replayInfo.defenders.length === 0) {
                        logDebug(`⏭️ Реплей ${win.replayId}: нет пачек защитников`);
                        continue;
                    }
                    if (!win.defenderPacks && replayInfo.defenders.length > 0) {
                        win.defenderPacks = replayInfo.defenders.map(d => ({
                            teamType: d.teamType,
                            teamString: d.teamString
                        }));
                        historyEnriched = true;
                    }
                    const defenderFreeSlots = [...freeSlots.values()].filter(s => s.defenderId === defenderId);
                    if (defenderFreeSlots.length === 0) {
                        logDebug(`⏭️ ${memberName}: защитник ${memberNames[defenderId] || defenderId} не имеет свободных слотов`);
                        continue;
                    }
                    logDebug(`🔍 ${memberName} → ${memberNames[defenderId] || defenderId}: проверяем ${defenderFreeSlots.length} слот(а/ов)`);
                    for (const [slotId, slot] of freeSlots.entries()) {
                        if (foundCount >= member.available) break;
                        if (slot.defenderId !== defenderId) continue;
                        logDebug(`   🔎 Слот ${slot.slotLocation} (${slot.defenderName}) [${slot.teamType}]:`);
                        logDebug(`      Текущая пачка: [${slot.teamString}]`);
                        const matchingTeam = replayInfo.defenders.find(
                            pastTeam => pastTeam.teamType === slot.teamType && pastTeam.teamString === slot.teamString
                        );
                        if (matchingTeam) {
                            logDebug(`      ✅ СОВПАДЕНИЕ с пачкой из реплея [${matchingTeam.teamType}]`);
                            logPanel(`✅ ${memberName} → ${slot.slotLocation}: ${slot.defenderName} (${foundCount + 1}/${member.available})`, 'success');
                            const attackerNames = replayInfo.attackers.length > 0 ? replayInfo.attackers[0].teamNames : '';
                            const defenderNamesWithPets = matchingTeam.teamNames;
                            try {
                                const result = await Caller.send({ name: 'clanWarSetTargetMark', args: { userId: member.id, slotId: slot.slotId } });
                                const isSuccess = result === null || result === undefined || !result.error;
                                if (isSuccess) {
                                    slot.assignedAttackerId = member.id;
                                    assigned.push({
                                        memberId: member.id,
                                        memberName,
                                        slotId: slot.slotId,
                                        defenderId,
                                        defenderName: slot.defenderName,
                                        teamNames: defenderNamesWithPets,
                                        attackerNames: attackerNames,
                                        slotLocation: slot.slotLocation,
                                        teamType: slot.teamType,
                                        teamString: slot.teamString
                                    });
                                    freeSlots.delete(slotId);
                                    foundDefenderSlots.add(defenderId);
                                    foundCount++;
                                    break;
                                } else {
                                    logPanel(`❌ Ошибка сервера: ${JSON.stringify(result)}`, 'error');
                                }
                            } catch (e) {
                                logPanel(`❌ Ошибка назначения: ${e.message}`, 'error');
                            }
                        } else {
                            const sameTypeTeam = replayInfo.defenders.find(pastTeam => pastTeam.teamType === slot.teamType);
                            if (sameTypeTeam) {
                                logDebug(`      ❌ Тип совпадает [${slot.teamType}], но пачка отличается:`);
                                logDebug(`         Реплей: [${sameTypeTeam.teamString}]`);
                            } else {
                                const availableTypes = replayInfo.defenders.map(d => d.teamType).join(', ');
                                logDebug(`      ❌ В реплее нет пачки типа [${slot.teamType}]. Доступные типы: [${availableTypes}]`);
                            }
                        }
                    }
                    await sleep(150);
                }
            }
            if (foundCount < member.available) {
                skipped.push(`${memberName}: назначено ${foundCount} из ${member.available} целей`);
                logPanel(foundCount === 0 ? `⏭️ ${memberName}: ни одна цель не найдена` : `⚠️ ${memberName}: назначено только ${foundCount} из ${member.available} целей`, 'warn');
            }
            await sleep(100);
        }

        if (historyEnriched) {
            saveHistory(mergedHistory);
            logPanel('💾 История обогащена данными о защитных пачках', 'info');
        }
        flushReplayCache();

        for (const a of assigned) {
            allSlots.push({
                slotId: a.slotId,
                slotLocation: a.slotLocation,
                defenderId: a.defenderId,
                defenderName: a.defenderName,
                teamType: a.teamType,
                teamString: a.teamString,
                assignedAttackerId: a.memberId
            });
        }

        setProgress(92);
        logPanel('━'.repeat(30), 'info');
        logPanel(`🏁 ИТОГО: Назначено ${assigned.length} целей, пропущено ${skipped.length} игроков`, 'highlight');
        if (assigned.length > 0) {
            logPanel('✅ Назначения:', 'success');
            for (const a of assigned) {
                logPanel(`  • ${a.memberName} → ${a.slotLocation}: ${a.defenderName}`, 'success');
                if (a.attackerNames) logTeamNames('     ⚔️', a.attackerNames);
                if (a.teamNames) logTeamNames('     🛡️ ', a.teamNames);
            }
        }
        if (skipped.length > 0) {
            logPanel('⚠️ Пропущено:', 'warn');
            for (const s of skipped) logPanel(`  • ${s}`, 'warn');
        }

        const usedTries = new Map();
        for (const a of assigned) usedTries.set(a.memberId, (usedTries.get(a.memberId) || 0) + 1);

        const hasFreeSlots = freeSlots.size > 0 || assigned.length > 0;
        setProgress(100);
        if (hasFreeSlots) {
            setPanelTitle(`🎯 Готово: ${assigned.length} целей. Нажмите ⚔️ для альтернатив`);
            if (altBtn) {
                altBtn.disabled = false;
                altBtn.title = 'Найти и назначить альтернативы (по истории побед)';
                altBtn.onclick = (e) => {
                    e.stopPropagation();
                    cancelAutoClose();
                    findAndAssignAlternatives(allSlots, assigned, guildMembers, usedTries, alreadyAttackedToday, memberNames, mergedHistory);
                };
            }
            logPanel('━'.repeat(30), 'info');
            logPanel(`💡 Нажмите ⚔️ для поиска и назначения альтернативных целей`, 'highlight');
        } else {
            setPanelTitle(`🎯 Готово: ${assigned.length} целей назначено`);
        }

        checkStorageSize();
    } catch (error) {
        logPanel(`💥 Критическая ошибка: ${error.message}`, 'error');
        setPanelTitle('🎯 Ошибка');
    }
    scheduleAutoClose();
}

/* ================================================================ /
/  РЕГИСТРАЦИЯ КНОПКИ                                                /
/  ================================================================ */
function registerButton() {
    const list = window.HWHData && window.HWHData.actionsPopupButtons;
    if (!list || typeof window.Caller === 'undefined') return false;
    if (list.some((b) => b && b.hwhGuildAutoTarget)) return true;
    const button = {
        hwhGuildAutoTarget: true,
        msg: '🎯 Авто-цели для гильдии',
        title: 'Назначает цели по истории побед. Учитывает уже занятые попытки (вручную или скриптом). Бэкап (💾) сохраняет историю + кэш.',
        color: 'purple',
        async result() {
            await sleep(300);
            await autoAssignGuildTargets();
        }
    };
    const closeIdx = list.findIndex((b) => b && b.isClose);
    if (closeIdx === -1) list.push(button);
    else list.splice(closeIdx, 0, button);
    console.log('[HWH CW Auto] ✅ Кнопка добавлена в меню "Действия"');
    return true;
}
registerButton();
})();
