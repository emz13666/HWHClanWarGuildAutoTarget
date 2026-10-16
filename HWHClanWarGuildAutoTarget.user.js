// ==UserScript==
// @name         HWHClanWarGuildAutoTarget
// @name:ru      Авто-цели ВГ для гильдии
// @namespace    HWHClanWarGuildAutoTarget
// @version      4.50
// @description  Automatically assigns Clan War targets to all guild members based on past full victories (+20 points). Shows building names instead of slot numbers. Caches replays in localStorage. Backup both history and replay cache to file. Accounts for pre-assigned targets. Logs team compositions in alternatives.
// @description:ru Автоматически назначает цели в Войне Гильдий всем членам гильдии по истории полных побед (+20 очков). В логах показывает названия зданий вместо номеров слотов. Кэширует реплеи в localStorage. Бэкап истории и кэша реплеев в файл. Учитывает цели, уже назначенные генералом до запуска. Показывает составы пачек в альтернативных назначениях.
// @author       emz13666
// @license      MIT
// @icon         data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiNmZmQyNGQiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48Y2lyY2xlIGN4PSIxMiIgY3k9IjEyIiByPSIxMCIvPjxjaXJjbGUgY3g9IjEyIiBjeT0iMTIiIHI9IjYiLz48Y2lyY2xlIGN4PSIxMiIgY3k9IjEyIiByPSIyIi8+PC9zdmc+
// @match        https://www.hero-wars.com/*
// @match        https://www.hero-wars.cn/*
// @match        https://apps-1701433570146040.apps.fbsbx.com/*
// @run-at       document-end
// @grant        none
// @downloadURL  https://gitverse.ru/api/repos/emz13/HWHClanWarGuildAutoTarget/raw/branch/main/HWHClanWarGuildAutoTarget.user.js
// @updateURL    https://gitverse.ru/api/repos/emz13/HWHClanWarGuildAutoTarget/raw/branch/main/HWHClanWarGuildAutoTarget.user.js
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

/* ================================================================ /
/ 🗄️ IndexedDB-хранилище (v4.49) с миграцией из localStorage      /
/ ================================================================ */
const IDB_NAME = 'HWHClanWarGuildAutoTarget';
const IDB_VERSION = 1;
const IDB_STORE_HISTORY = 'history';   // ключ: "<season>_<day>"
const IDB_STORE_REPLAYS = 'replays';   // ключ: "<replayId>"
const MIGRATION_FLAG = 'HWH_CW_MigratedToIDB_v1';

class CwIdb {
    constructor() {
        this.db = null;
        this.available = true;
    }

    async open() {
        if (this.db) return this.db;
        if (typeof indexedDB === 'undefined') { this.available = false; return null; }
        return new Promise((resolve) => {
            let req;
            try {
                req = indexedDB.open(IDB_NAME, IDB_VERSION);
            } catch (e) {
                this.available = false;
                resolve(null);
                return;
            }
            req.onerror = () => { this.available = false; resolve(null); };
            req.onsuccess = () => { this.db = req.result; resolve(this.db); };
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(IDB_STORE_HISTORY)) db.createObjectStore(IDB_STORE_HISTORY);
                if (!db.objectStoreNames.contains(IDB_STORE_REPLAYS)) db.createObjectStore(IDB_STORE_REPLAYS);
            };
        });
    }

    _tx(store, mode) {
        return this.db.transaction([store], mode).objectStore(store);
    }

    async put(store, key, value) {
        if (!this.available) return false;
        await this.open();
        if (!this.db) return false;
        return new Promise((resolve) => {
            const req = this._tx(store, 'readwrite').put(value, key);
            req.onsuccess = () => resolve(true);
            req.onerror = () => { console.warn('[CW IDB] put error', req.error); resolve(false); };
        });
    }

    async get(store, key) {
        if (!this.available) return undefined;
        await this.open();
        if (!this.db) return undefined;
        return new Promise((resolve) => {
            const req = this._tx(store, 'readonly').get(key);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(undefined);
        });
    }

    async delete(store, key) {
        if (!this.available) return;
        await this.open();
        if (!this.db) return;
        return new Promise((resolve) => {
            const req = this._tx(store, 'readwrite').delete(key);
            req.onsuccess = () => resolve();
            req.onerror = () => resolve();
        });
    }

    async getAll(store) {
        if (!this.available) return [];
        await this.open();
        if (!this.db) return [];
        return new Promise((resolve) => {
            const req = this._tx(store, 'readonly').getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => resolve([]);
        });
    }

    async getAllKeys(store) {
        if (!this.available) return [];
        await this.open();
        if (!this.db) return [];
        return new Promise((resolve) => {
            const req = this._tx(store, 'readonly').getAllKeys();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => resolve([]);
        });
    }

    async clear(store) {
        if (!this.available) return;
        await this.open();
        if (!this.db) return;
        return new Promise((resolve) => {
            const req = this._tx(store, 'readwrite').clear();
            req.onsuccess = () => resolve();
            req.onerror = () => resolve();
        });
    }

    /** Удалить записи старше N дней (для реплеев — по ts, для истории — по ключу-дате) */
    async pruneHistory(maxDays) {
        const keys = await this.getAllKeys(IDB_STORE_HISTORY);
        const sorted = keys.sort(compareHistoryKeys);
        const toDelete = sorted.slice(maxDays);
        for (const k of toDelete) await this.delete(IDB_STORE_HISTORY, k);
        return toDelete.length;
    }

    async pruneReplays(maxEntries) {
        const keys = await this.getAllKeys(IDB_STORE_REPLAYS);
        if (keys.length <= maxEntries) return 0;
        // Оставляем последние maxEntries (порядок появления ключей не гарантирован, поэтому
        // удаляем просто "лишние" - стратегия как в старом saveReplayCache)
        const toDelete = keys.slice(0, keys.length - maxEntries);
        for (const k of toDelete) await this.delete(IDB_STORE_REPLAYS, k);
        return toDelete.length;
    }
}

const cwIdb = new CwIdb();

/* ================================================================ /
/ 🔄 Миграция из localStorage → IndexedDB                          /
/ ================================================================ */
async function migrateLocalStorageToIdb() {
    if (localStorage.getItem(MIGRATION_FLAG) === 'done') {
        // 🔥 Автолечение: если LS-ключи каким-то образом вернулись — переносим заново
        if (localStorage.getItem(STORAGE_KEY) || localStorage.getItem(REPLAY_CACHE_KEY)) {
            logPanel('⚠️ Флаг миграции стоит, но LS-ключи существуют — домигрируем', 'warn');
            localStorage.removeItem(MIGRATION_FLAG);
        } else {
            return;
        }
    }
    if (!cwIdb.available) {
        logPanel('⚠️ IndexedDB недоступен, продолжаем на localStorage', 'warn');
        return;
    }
    await cwIdb.open();
    if (!cwIdb.db) return;

    // 🔥 Проверяем, есть ли вообще что мигрировать
    const hasLsHistory = !!localStorage.getItem(STORAGE_KEY);
    const hasLsReplays = !!localStorage.getItem(REPLAY_CACHE_KEY);
    if (!hasLsHistory && !hasLsReplays) {
        // Нечего переносить — просто ставим флаг и идём дальше
        localStorage.setItem(MIGRATION_FLAG, 'done');
        return;
    }

    logPanel('🔄 Миграция localStorage → IndexedDB...', 'info');

    let historyOk = true, replaysOk = true;
    let historyCount = 0, replaysCount = 0, historyFailed = 0, replaysFailed = 0;

    // ---- История ----
    if (hasLsHistory) {
        try {
            const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
            for (const [dayKey, battles] of Object.entries(parsed)) {
                if (!Array.isArray(battles) || battles.length === 0) continue;
                const ok = await cwIdb.put(IDB_STORE_HISTORY, dayKey, battles);  // 🔥 проверяем результат
                if (ok) historyCount++;
                else { historyFailed++; historyOk = false; }
            }
            if (historyOk) {
                localStorage.removeItem(STORAGE_KEY);
                logPanel(`  📚 История: перенесено ${historyCount} дней`, 'info');
            } else {
                logPanel(`  ⚠️ История: перенесено ${historyCount}, ошибок ${historyFailed} — LS НЕ удалён`, 'warn');
            }
        } catch (e) {
            historyOk = false;
            logPanel('  ❌ Ошибка миграции истории: ' + e.message, 'error');
        }
    }

    // ---- Кэш реплеев ----
    if (hasLsReplays) {
        try {
            const parsed = JSON.parse(localStorage.getItem(REPLAY_CACHE_KEY));
            for (const [replayId, value] of Object.entries(parsed)) {
                if (!replayId || !value) continue;
                const ok = await cwIdb.put(IDB_STORE_REPLAYS, replayId, value);
                if (ok) replaysCount++;
                else { replaysFailed++; replaysOk = false; }
            }
            if (replaysOk) {
                localStorage.removeItem(REPLAY_CACHE_KEY);
                logPanel(`  📼 Кэш реплеев: перенесено ${replaysCount} записей`, 'info');
            } else {
                logPanel(`  ⚠️ Реплеи: перенесено ${replaysCount}, ошибок ${replaysFailed} — LS НЕ удалён`, 'warn');
            }
        } catch (e) {
            replaysOk = false;
            logPanel('  ❌ Ошибка миграции реплеев: ' + e.message, 'error');
        }
    }

    // 🔥 Флаг 'done' ставим ТОЛЬКО если всё прошло успешно
    if (historyOk && replaysOk) {
        localStorage.setItem(MIGRATION_FLAG, 'done');
        logPanel('✅ Миграция завершена, старые LS-ключи удалены', 'success');
    } else {
        logPanel('⚠️ Миграция неполная: LS-ключи сохранены, повторим при следующем запуске', 'warn');
    }
}

/* ================================================================ /
/ 📚 Загрузка истории из IDB в память                              /
/ ================================================================ */
async function loadHistoryFromIdb() {
    const keys = await cwIdb.getAllKeys(IDB_STORE_HISTORY);
    const result = {};
    for (const k of keys) {
        const battles = await cwIdb.get(IDB_STORE_HISTORY, k);
        if (Array.isArray(battles) && battles.length > 0) result[k] = battles;
    }
    return result;
}

/* ================================================================ /
/ 💾 Сохранение истории в IDB (по дням — только изменённые дни)    /
/ ================================================================ */
function compareHistoryKeys(a, b) {
    const [sa, da] = a.split('_').map(n => parseInt(n, 10));
    const [sb, db] = b.split('_').map(n => parseInt(n, 10));
    if (sa !== sb) return sb - sa;  // новые сезоны вперёд
    return db - da;                 // новые дни вперёд
}

async function saveHistoryToIdb(history, changedKeys = null) {
    const keys = Object.keys(history).sort(compareHistoryKeys);
    const kept = keys.slice(0, MAX_HISTORY_DAYS);
    const existing = new Set(await cwIdb.getAllKeys(IDB_STORE_HISTORY));

    let saved = 0, cleaned = 0;
    for (const k of kept) {
        const cleanKey = k.trim();

        // 🔥 Если день не менялся и уже есть в IDB — пропускаем
        if (changedKeys && !changedKeys.has(cleanKey) && existing.has(cleanKey)) {
            existing.delete(cleanKey);
            continue;
        }

        const battles = Array.isArray(history[k]) ? history[k] : [];
        const cleanBattles = battles.filter(b => !isEmptyBattle(b));
        cleaned += battles.length - cleanBattles.length;

        const seen = new Set();
        const deduped = cleanBattles.filter(b => {
            if (seen.has(b.replayId)) return false;
            seen.add(b.replayId);
            return true;
        });

        if (deduped.length > 0) {
            await cwIdb.put(IDB_STORE_HISTORY, cleanKey, deduped);
            saved++;
        }
        existing.delete(cleanKey);
    }

    for (const k of existing) await cwIdb.delete(IDB_STORE_HISTORY, k);

    if (cleaned > 0) logPanel(`🧹 При сохранении очищено ${cleaned} "пустых" боёв`, 'info');
    logPanel(`💾 База истории: записано ${saved} дней (макс. ${MAX_HISTORY_DAYS})`, 'info');
}

/* ================================================================  /
/  📊 ПРОВЕРКА ОБЪЁМА IDB                                 /
/  ================================================================ */
async function checkStorageSize() {
    try {
        const histKeys = await cwIdb.getAllKeys(IDB_STORE_HISTORY);
        const replayKeys = await cwIdb.getAllKeys(IDB_STORE_REPLAYS);

        let usageMB = '—';
        if (navigator.storage?.estimate) {
            const { usage } = await navigator.storage.estimate();
            usageMB = (usage / 1024 / 1024).toFixed(2);
        }

        console.group(`%c[HWH CW Auto] 📊 Состояние IndexedDB`, 'color: #ffd24d; font-weight: bold');
        console.log(`📚 История: ${histKeys.length} дней`);
        console.log(`📼 Кэш реплеев: ${replayKeys.length} записей (макс. ${MAX_REPLAY_CACHE_ENTRIES})`);
        console.log(`📦 Использовано браузером (общая оценка): ${usageMB} МБ`);
        console.groupEnd();
    } catch (e) {
        console.error('[HWH CW Auto] Ошибка проверки IDB:', e);
    }
}
async function initStorage() {
    await cwIdb.open();
    await migrateLocalStorageToIdb();
    await reloadReplayCache();
    await checkStorageSize();
}



/* ================================================================= /
/ 📼 КЭШ РЕПЛЕЕВ                                                    /
/ ================================================================ */
const replayMemoryCache = new Map();
let replayStorageCache = null;  // заполняется из IDB при старте
let replayStorageDirty = false;
const dirtyReplayIds = new Set();  // 🔥 записываем в IDB только изменённые

async function loadReplayCache() {
    try {
        const keys = await cwIdb.getAllKeys(IDB_STORE_REPLAYS);
        const result = {};
        for (const k of keys) {
            const v = await cwIdb.get(IDB_STORE_REPLAYS, k);
            if (v) result[k] = v;
        }
        return result;
    } catch (e) {
        console.error('[HWH CW Auto] Ошибка загрузки кэша реплеев:', e);
        return {};
    }
}

async function saveReplayCache(cache) {
    try {
        // Точечно сохраняем только "грязные" ключи
        if (dirtyReplayIds.size > 0) {
            for (const id of dirtyReplayIds) {
                if (cache[id]) {
                    await cwIdb.put(IDB_STORE_REPLAYS, id, cache[id]);
                } else {
                    await cwIdb.delete(IDB_STORE_REPLAYS, id);
                }
            }
            dirtyReplayIds.clear();
        }
        await cwIdb.pruneReplays(MAX_REPLAY_CACHE_ENTRIES);
        return true;
    } catch (e) {
        console.error('[HWH CW Auto] Ошибка сохранения кэша реплеев:', e);
        return false;
    }
}

async function getReplayStorageCache() {
    if (replayStorageCache === null) {
        replayStorageCache = await loadReplayCache();
    }
    return replayStorageCache;
}

async function reloadReplayCache(force = false) {
    if (!force && replayStorageCache !== null) {
        logDebug('🔄 Кэш реплеев уже загружен, пропускаем перечитывание');
        return;
    }
    replayStorageCache = await loadReplayCache();
    replayMemoryCache.clear();
    for (const [k, v] of Object.entries(replayStorageCache)) {
        replayMemoryCache.set(k, v);
    }
    replayStorageDirty = false;
    dirtyReplayIds.clear();
    logPanel(`🔄 Кэш реплеев перечитан: ${replayMemoryCache.size} записей`, 'info');
}

async function flushReplayCache() {
    if (replayStorageDirty && replayStorageCache) {
        const success = await saveReplayCache(replayStorageCache);
        if (success) {
            replayStorageDirty = false;
            logPanel(`💾 Кэш реплеев сохранён: ${Object.keys(replayStorageCache).length} записей`, 'info');
        }
    }
}

/* ================================================================ /
/ 🔥 v4.46: ЗАГРУЗКА РЕПЛЕЯ С ТРЁХУРОВНЕВЫМ КЭШЕМ                /
/ (Восстановлена после случайного удаления)                        /
/ ================================================================ */
async function getReplayInfo(replayId) {
    // 1. Проверяем кэш в памяти (самый быстрый)
    if (replayMemoryCache.has(replayId)) return replayMemoryCache.get(replayId);

    // 2. Проверяем кэш в localStorage
    const storageCache = await getReplayStorageCache();
    if (storageCache[replayId]) {
        const cached = storageCache[replayId];
        replayMemoryCache.set(replayId, cached);
        logDebug(`📼 Реплей ${replayId}: взят из кэша localStorage`);
        return cached;
    }

    // 3. Загружаем с сервера, если в кэше нет
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
        
        // Сохраняем в оба уровня кэша
        replayMemoryCache.set(replayId, result);
        storageCache[replayId] = result;
        replayStorageDirty = true;
        dirtyReplayIds.add(replayId);  // 🔥 помечаем для точечной записи
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
/ 🗄️ РАБОТА С ЛОКАЛЬНОЙ БАЗОЙ ИСТОРИИ                            /
/ ================================================================ */
async function loadHistory() {
    if (!cwIdb.available) {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
        catch (e) { return {}; }
    }
    try { return await loadHistoryFromIdb(); }
    catch (e) { logPanel('Ошибка чтения истории: ' + e.message, 'warn'); return {}; }
}

async function saveHistory(history, changedKeys = null) {
    if (!cwIdb.available) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(history)); }
        catch (e) { logPanel('Ошибка сохранения в LS: ' + e.message, 'error'); }
        return;
    }
    try { await saveHistoryToIdb(history, changedKeys); }
    catch (e) { logPanel('Ошибка сохранения истории: ' + e.message, 'error'); }
}

function isEmptyBattle(battle) {
    if (!battle || typeof battle !== 'object') return true;
    const replayId = String(battle.replayId ?? '');
    return replayId === '0' || replayId === '';
}

function isFullWin(battle) {
    if (!battle.win) return false;
    if (battle.slotPoints === undefined || battle.slotPoints === null) return true;
    return battle.slotPoints === 20;
}
async function mergeAndSaveHistory(newData) {
    const history = await loadHistory();
    let updated = false, newBattles = 0, skippedDuplicates = 0, skippedEmpty = 0, skippedEmptyDays = 0;
    const changedKeys = new Set();  // 🔥

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
        changedKeys.add(key.trim());  // 🔥
    }

    if (updated) await saveHistory(history, changedKeys);  // 🔥
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
async function exportHistory() {
    try {
        const historyParsed = await loadHistory();
        const replayParsed = await getReplayStorageCache();

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

async function importHistory() {
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

            // ---- Разбор формата файла ----
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

            // ---- Импорт истории ----
            let historyMsg = '';
            if (historyData) {
                let validEntries = 0, skippedEmpty = 0;
                for (const [key, value] of Object.entries(historyData)) {
                    if (!Array.isArray(value)) throw new Error(`Неверный формат данных в ключе истории: ${key}`);
                    validEntries++;
                }

                const existing = await loadHistory();
                const merged = { ...existing };
                const changedKeys = new Set();   // 🔥 только реально изменённые дни

                for (const [key, battles] of Object.entries(historyData)) {
                    const existingReplays = new Set((merged[key] || []).map(b => b.replayId));
                    const validNewBattles = [];
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
                    changedKeys.add(key.trim());
                }

                await saveHistory(merged, changedKeys);

                let totalBattles = 0;
                for (const key of Object.keys(merged)) totalBattles += merged[key].length;
                historyMsg = `история: ${validEntries} дн., ${totalBattles} битв`;
                if (skippedEmpty > 0) historyMsg += `, пропущено пустых: ${skippedEmpty}`;
            }

            // ---- Импорт кэша реплеев ----
            let replayMsg = '';
            if (replayData) {
                const existingCache = await getReplayStorageCache();
                let newCount = 0, skippedDuplicates = 0;

                for (const [replayId, value] of Object.entries(replayData)) {
                    if (!replayId || !value) { skippedDuplicates++; continue; }
                    if (existingCache[replayId]) { skippedDuplicates++; continue; }
                    existingCache[replayId] = value;
                    dirtyReplayIds.add(replayId);           // 🔥 точечная запись в IDB
                    if (!replayMemoryCache.has(replayId)) {
                        replayMemoryCache.set(replayId, value);
                    }
                    newCount++;
                }

                const saveOk = await saveReplayCache(existingCache);
                if (saveOk) {
                    replayStorageCache = existingCache;
                    replayStorageDirty = false;
                    replayMsg = `кэш реплеев: +${newCount} новых (всего ${Object.keys(existingCache).length})`;
                    if (skippedDuplicates > 0) replayMsg += `, дубликатов: ${skippedDuplicates}`;
                } else {
                    replayMsg = 'кэш реплеев: ошибка сохранения (IDB недоступен?)';
                }
            }

            // ---- Итог ----
            const parts = [];
            if (historyMsg) parts.push(historyMsg);
            if (replayMsg) parts.push(replayMsg);
            if (parts.length === 0) {
                logPanel(`📂 Файл "${file.name}" импортирован, но новых данных не добавлено`, 'warn');
            } else {
                logPanel(`📂 Импортировано из "${file.name}": ${parts.join(' | ')}`, 'success');
            }

            await checkStorageSize();
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
/ 🔥 v4.46: ПОСТРОЕНИЕ ИНДЕКСА ПАЧЕК (с обогащением и кэшем)     /
/ Исправлена ошибка "ri is not defined"                            /
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
            // 🔥 v4.46: объявляем ri ДО ветвления
            let ri = null;
            
            if (Array.isArray(b.defenderPacks) && b.defenderPacks.length > 0) {
                defenders = b.defenderPacks;
                fromStorage++;
                // 🔥 v4.46: пытаемся взять полную информацию о реплее из кэша
                // (нам нужны имена атакующих для логов альтернатив)
                if (replayMemoryCache.has(b.replayId)) {
                    ri = replayMemoryCache.get(b.replayId);
                } else {
                    const storageCache = await getReplayStorageCache();
                    if (storageCache[b.replayId]) {
                        ri = storageCache[b.replayId];
                        replayMemoryCache.set(b.replayId, ri);
                    }
                }
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
                ri = await getReplayInfo(b.replayId);
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
                
                // 🔥 v4.46: безопасное обращение к ri
                let attackerNames = '';
                if (ri && Array.isArray(ri.attackers) && ri.attackers.length > 0) {
                    attackerNames = ri.attackers[0].teamNames || '';
                }

                if (!am.has(b.attackerId)) {
                    am.set(b.attackerId, {
                        wins: 0,
                        replayId: b.replayId,
                        attackerNames: attackerNames,
                        defenderNames: d.teamNames || ''
                    });
                }
                const entry = am.get(b.attackerId);
                entry.wins++;
                entry.replayId = b.replayId;
                // Обновляем имена, если они теперь доступны (из кэша)
                if (attackerNames) entry.attackerNames = attackerNames;
                if (d.teamNames) entry.defenderNames = d.teamNames;
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
        
        // 🔥 v4.45: d теперь это объект { wins, replayId, attackerNames, defenderNames }
        for (const [atkId, data] of am) {
            const member = guildMembers.find(m => m.id === atkId);
            if (!member) continue;
            
            const available = member.available;
            const usedInThisRun = usedTries.get(atkId) || 0;
            const left = available - usedInThisRun;
            const name = memberNames[atkId] || atkId;
            
            const entry = {
                attackerId: atkId,
                attackerName: name,
                winsCount: data.wins,
                triesLeft: left,
                attackerNames: data.attackerNames,
                defenderNames: data.defenderNames
            };
            
            all.push(entry);
            
            // Исключаем, если не осталось попыток или игрок уже на этом слоте
            if (left <= 0 || slot.assignedAttackerId === atkId || alreadyAttackedToday.has(slot.defenderId)) continue;
            filtered.push(entry);
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
                    
                    // 🔥 v4.45: Логирование составов пачек, как в основном цикле
                    if (alt.attackerNames) logTeamNames('     ⚔️', alt.attackerNames);
                    if (alt.defenderNames) logTeamNames('     🛡️ ', alt.defenderNames);
                    
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
    await checkStorageSize();
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
            await saveHistory(mergedHistory);
            await flushReplayCache();
            logPanel(`💾 История обогащена (+${enrichedCount} записей), кэш реплеев обновлён`, 'info');
        } else {
            await flushReplayCache();
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
    await initStorage();
    try {
        if (typeof Caller === 'undefined' || typeof Caller.send === 'undefined') {
            logPanel('⚠️ HeroWarsHelper (Caller) не найден.', 'error');
            scheduleAutoClose();
            return;
        }

        logPanel('📜 Обновление базы истории боёв...', 'info');
        setProgress(5);
        let mergedHistory = await loadHistory();
        let historyKeys = Object.keys(mergedHistory).sort(compareHistoryKeys);
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
                mergedHistory = await mergeAndSaveHistory(newDataToMerge);
                historyKeys = Object.keys(mergedHistory).sort(compareHistoryKeys);
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
            await checkStorageSize();
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
            // Исправлено! Игра использует targetMarkingUserId для отметки цели,
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
            await checkStorageSize();
            scheduleAutoClose();
            return;
        }
        if (freeSlots.size === 0) {
            logPanel('⚠️ Нет свободных слотов.', 'warn');
            await checkStorageSize();
            scheduleAutoClose();
            return;
        }

        const assigned = [];
        const skipped = [];
        let historyEnriched = false;
        const enrichedKeys = new Set();   // 🔥 сюда собираем ключи изменённых дней

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
                    
                    // 🔥 v4.46: Теперь getReplayInfo определён и работает корректно
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
                        enrichedKeys.add(key);   // 🔥
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
            await saveHistory(mergedHistory, enrichedKeys);   // 🔥 точечно
            logPanel(`💾 История обогащена в ${enrichedKeys.size} днях`, 'info');
        }
        await flushReplayCache();

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

        await checkStorageSize();
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
        title: 'Назначает цели по истории побед. Учитывает уже занятые попытки. Показывает составы пачек в альтернативах. Бэкап (💾) сохраняет историю + кэш.',
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
