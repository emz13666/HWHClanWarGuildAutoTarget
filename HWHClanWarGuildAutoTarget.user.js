// ==UserScript==
// @name         HWHClanWarGuildAutoTarget
// @name:ru      Авто-цели ВГ для гильдии (каскадный подбор целей)
// @namespace    HWHClanWarGuildAutoTarget
// @version      4.62
// @description  Automatically assigns Clan War targets to all guild members based on past full victories (+20 points). Shows building names instead of slot numbers. Caches replays in localStorage. Backup both history and replay cache to file. Accounts for pre-assigned targets. Logs team compositions in alternatives.
// @description:ru Автоматически назначает цели в Войне Гильдий всем членам гильдии по истории полных побед (+20 очков). В логах показывает названия зданий вместо номеров слотов. Кэширует реплеи в localStorage. Бэкап истории и кэша реплеев в файл. Учитывает цели, уже назначенные генералом до запуска. Показывает составы пачек в альтернативных назначениях.
// @author       emz13666, Nemo with AI
// @license      MIT
// @icon         data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiNmZmQyNGQiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48Y2lyY2xlIGN4PSIxMiIgY3k9IjEyIiByPSIxMCIvPjxjaXJjbGUgY3g9IjEyIiBjeT0iMTIiIHI9IjYiLz48Y2lyY2xlIGN4PSIxMiIgY3k9IjEyIiByPSIyIi8+PC9zdmc+
// @match        https://www.hero-wars.com/*
// @match        https://www.hero-wars.cn/*
// @match        https://apps-1701433570146040.apps.fbsbx.com/*
// @run-at       document-end
// @grant        none
// @downloadURL  https://raw.githubusercontent.com/emz13666/HWHClanWarGuildAutoTarget/main/HWHClanWarGuildAutoTargetCascade.user.js
// @updateURL    https://raw.githubusercontent.com/emz13666/HWHClanWarGuildAutoTarget/main/HWHClanWarGuildAutoTargetCascade.user.js
// ==/UserScript==

(async function () {
    'use strict';

/* ================================================================
/  КОНСТАНТЫ
/ ================================================================ */

    const IDB_NAME                = 'HWHClanWarGuildAutoTarget';
    const IDB_VERSION             = 1;
    const IDB_STORE_HISTORY       = 'history';
    const IDB_STORE_REPLAYS       = 'replays';
    const MIGRATION_FLAG          = 'HWH_CW_MigratedToIDB_v2';

    const STORAGE_KEY             = 'HWH_CW_History_Log_v1';
    const REPLAY_CACHE_KEY        = 'HWH_CW_Replay_Cache_v2';
    const LEGACY_REPLAY_KEYS = ['HWH_CW_Replay_Cache_v1', 'HWH_CW_Replay_Cache_v2'];

    const MAX_REPLAY_CACHE_ENTRIES = 3000;
    const MAX_HISTORY_DAYS         = 90;
    const LOCALSTORAGE_LIMIT_MB    = 5;
    const EXPORT_FORMAT_VERSION    = 3;

    const AUTO_CLOSE_DELAY_SECONDS = 10;
    const DEBUG_MODE               = true;

    const SIM_COUNT_PROBABILITY    = 10;
    const SIM_YIELD_PROBABILITY_MS = 50;

    const AUTO_ASSIGN_MATCH_MODE       = 'cascade';
    const CASCADE_MIN_WINS             = 1;
    const CASCADE_ALLOW_OTHER_DEFENDER = true;

    const KEEP_ASSIGNMENTS_DAYS                  = 365;
    const ASSIGNMENTS_SIZE_WARN_MB               = 30;
    const ASSIGNMENTS_ARCHIVE_THRESHOLD_MB       = 50;
    const ASSIGNMENTS_ARCHIVE_OLDER_THAN_DAYS    = 180;

    const SHOW_ASSIGNMENTS_ON_START = true;
    const POPUP_COOLDOWN_MINUTES    = 30;
    const SHOW_ON_START_KEY         = 'HWH_CW_ShowOnStart';
    const NO_UNIT_LEVELS_KEY        = 'HWH_CW_NoUnitLevelsInClipboard';

/* ================================================================
/  НАСТРОЙКИ
/ ================================================================ */
    function getShowOnStart() {
        const v = localStorage.getItem(SHOW_ON_START_KEY);
        return v === null ? SHOW_ASSIGNMENTS_ON_START : v === 'true';
    }
    function getNoUnitLevels() {
    return localStorage.getItem(NO_UNIT_LEVELS_KEY) === 'true';
    }

 /* ============================================================
 * РЕЖИМ ВОЙНЫ (только ВГ)
 * ============================================================ */
    const WAR_MODE_CLAN = 'clanWar';
    const WAR_MODE_LABEL = 'ВГ';

/* ================================================================
/  ОЖИДАНИЕ ЗАГРУЗКИ HWH
/ ================================================================ */
    async function waitForHelper(timeout = 60000) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            if (globalThis.HWHClasses && globalThis.HWHFuncs && globalThis.HWHData && globalThis.Caller) return true;
            await new Promise(r => setTimeout(r, 500));
        }
        return false;
    }

    const found = await waitForHelper();
    if (!found) {
        console.log('%c[HWH CW Cascade] Объект расширения не найден', 'color: red');
        return;
    }

    const {
        I18N = (k) => k,
        popup,
        getUserInfo = () => ({}),
        addExtentionName = () => {},
        Events,
    } = globalThis.HWHFuncs;

    try {
        addExtentionName(GM_info.script.name, GM_info.script.version, GM_info.script.author);
    } catch (e) {
        console.warn('[HWH CW Cascade] Не удалось зарегистрировать расширение:', e);
    }

    console.log(`%cStart Extension ${GM_info.script.name}, v${GM_info.script.version} by ${GM_info.script.author}`, 'color: #ffd24d');

    window.__hwhCWCanAssign = undefined;

/* ================================================================
/  ПРОВЕРКА ПРАВ НА НАЗНАЧЕНИЕ ЦЕЛЕЙ
/ ================================================================ */
    async function canAssignTargets() {
        if (window.__hwhCWCanAssign !== undefined) return window.__hwhCWCanAssign;

        try {
            const me = getUserInfo() || {};
            const myId = String(me.id || me.accountId || '');
            if (!myId) {
                logDebug('canAssignTargets: myId пуст → разрешаем');
                window.__hwhCWCanAssign = true;
                return true;
            }

            const clanInfo = await Caller.send('clanGetInfo');
            const members = clanInfo?.clan?.members;
            if (!members) {
                logDebug('canAssignTargets: clan.members пуст → разрешаем');
                window.__hwhCWCanAssign = true;
                return true;
            }

            let myMember = null;
            const memberMatch = (m) => m && (
                String(m.id) === myId ||
                String(m.accountId) === myId
            );

            if (Array.isArray(members)) {
                myMember = members.find(memberMatch);
            } else {
                myMember = members[myId];
                if (myMember && typeof myMember !== 'object') myMember = null;
                if (!myMember) {
                    for (const k in members) {
                        const m = members[k];
                        if (memberMatch(m)) { myMember = m; break; }
                    }
                }
            }

            if (!myMember) {
                logDebug(`canAssignTargets: myId=${myId} не найден в clan.members → разрешаем (сервер проверит)`);
                window.__hwhCWCanAssign = true;
                return true;
            }

            const roleRaw = myMember.clanRole;
            const role = (typeof roleRaw === 'string') ? parseInt(roleRaw, 10) : roleRaw;
            const can = (role === 255 || role === 4);
            window.__hwhCWCanAssign = can;

            console.log(
                `%c[HWH CW Cascade] canAssignTargets: ` +
                `name=${myMember.name}, myId=${myId}, ` +
                `clanRole=${JSON.stringify(roleRaw)} (type ${typeof roleRaw}) → ` +
                `${can ? 'МОЖЕТ' : 'НЕ МОЖЕТ'}`,
                can ? 'color: #7fff7f' : 'color: #ff8a80'
            );

            return can;
        } catch (e) {
            logDebug('canAssignTargets: error ' + e.message);
        }

        window.__hwhCWCanAssign = true;
        return true;
    }

/* ================================================================
/  УТИЛИТЫ
/ ================================================================ */
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    async function calcProbability(battle, N = SIM_COUNT_PROBABILITY, yieldMs = SIM_YIELD_PROBABILITY_MS) {
        if (!battle || typeof globalThis.Calc !== 'function') return null;
        if (!battle.type && !battle.effects?.battleConfig) {
            console.warn('[HWH CW Cascade] battle.type отсутствует — симуляция может упасть');
        }
        let wins = 0, total = 0;
        for (let i = 0; i < N; i++) {
            try {
                const sim = structuredClone(battle);
                sim.seed = Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 1e6);
                sim.progress = [{ attackers: { input: ['auto', 0, 0, 'auto', 0, 0] } }];
                const r = await globalThis.Calc(sim);
                total++;
                if (r?.result?.win) wins++;
            } catch (e) {
                console.warn('[HWH CW Cascade] симуляция упала:', e.message);
            }
            await sleep(yieldMs);
        }
        if (total === 0) return null;
        return wins / total;
    }

    function findBattleInHistory(history, replayId) {
        if (!history || !replayId) return null;
        const rid = String(replayId);
        for (const key in history) {
            for (const b of (history[key] || [])) {
                if (String(b.replayId) === rid) return { battle: b, key };
            }
        }
        return null;
    }

    function compareHistoryKeys(a, b) {
        const parse = (k) => {
            if (k.startsWith('sm_')) {
                const parts = k.split('_');
                return { sort: 1, major: parseInt(parts[1]) || 0, minor: parseInt(parts[2]) || 0 };
            }
            const [s, d] = k.split('_').map(n => parseInt(n, 10));
            return { sort: 0, major: s || 0, minor: d || 0 };
        };
        const pa = parse(a), pb = parse(b);
        if (pa.sort !== pb.sort) return pa.sort - pb.sort;
        if (pa.major !== pb.major) return pb.major - pa.major;
        return pb.minor - pa.minor;
    }

    function plural(n, forms) {
        const mod10  = n % 10;
        const mod100 = n % 100;
        if (mod10 === 1 && mod100 !== 11) return forms[0];
        if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1];
        return forms[2];
    }

    function whereLabel(season, day) {
        return day != null ? `${season}/${day}` : `сезон ${season}`;
    }

/* ================================================================
/  КЛАСС CwIdb
/ ================================================================ */
    class CwIdb {
        constructor() { this.db = null; this.available = true; }

        async open() {
            if (this.db) return this.db;
            if (typeof indexedDB === 'undefined') { this.available = false; return null; }
            return new Promise((resolve) => {
                let req;
                try { req = indexedDB.open(IDB_NAME, IDB_VERSION); }
                catch (e) { this.available = false; resolve(null); return; }
                req.onerror = () => { this.available = false; resolve(null); };
                req.onsuccess = () => {
                    const db = req.result;
                    const hasHistory = db.objectStoreNames.contains(IDB_STORE_HISTORY);
                    const hasReplays = db.objectStoreNames.contains(IDB_STORE_REPLAYS);

                    if (!hasHistory || !hasReplays) {
                        console.warn('[CW IDB] Store\'ы отсутствуют, пересоздаём БД...');
                        db.close();
                        const delReq = indexedDB.deleteDatabase(IDB_NAME);
                        delReq.onsuccess = () => {
                            const newReq = indexedDB.open(IDB_NAME, IDB_VERSION);
                            newReq.onupgradeneeded = (e) => {
                                const ndb = e.target.result;
                                if (!ndb.objectStoreNames.contains(IDB_STORE_HISTORY)) ndb.createObjectStore(IDB_STORE_HISTORY);
                                if (!ndb.objectStoreNames.contains(IDB_STORE_REPLAYS)) ndb.createObjectStore(IDB_STORE_REPLAYS);
                            };
                            newReq.onsuccess = () => { this.db = newReq.result; resolve(this.db); };
                            newReq.onerror = () => { this.available = false; resolve(null); };
                        };
                        delReq.onerror = () => { this.available = false; resolve(null); };
                        delReq.onblocked = () => { this.available = false; resolve(null); };
                    } else {
                        this.db = db;
                        resolve(this.db);
                    }
                };
                req.onupgradeneeded = (e) => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains(IDB_STORE_HISTORY)) db.createObjectStore(IDB_STORE_HISTORY);
                    if (!db.objectStoreNames.contains(IDB_STORE_REPLAYS)) db.createObjectStore(IDB_STORE_REPLAYS);
                };
            });
        }

        _tx(store, mode) { return this.db.transaction([store], mode).objectStore(store); }

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

        async pruneHistory(maxDays) {
            const keys = await this.getAllKeys(IDB_STORE_HISTORY);
            const sortedKeys = keys.sort(compareHistoryKeys);
            const toDelete = sortedKeys.slice(maxDays);
            for (const k of toDelete) await this.delete(IDB_STORE_HISTORY, k);
            return toDelete.length;
        }

        async pruneReplays(maxEntries) {
            const keys = await this.getAllKeys(IDB_STORE_REPLAYS);
            if (keys.length <= maxEntries) return 0;

            const toDelete = keys.slice(0, Math.max(0, keys.length - maxEntries));
            for (const k of toDelete) await this.delete(IDB_STORE_REPLAYS, k);
            return toDelete.length;
        }
    }

    const cwIdb = new CwIdb();

/* ================================================================
/  МИГРАЦИЯ localStorage → IndexedDB
/ ================================================================ */
    async function migrateLocalStorageToIdb() {
        const lsReplayKeys = LEGACY_REPLAY_KEYS.filter(k => localStorage.getItem(k));
        const hasLsHistory = !!localStorage.getItem(STORAGE_KEY);
        const hasLsReplays = lsReplayKeys.length > 0;

        if (localStorage.getItem(MIGRATION_FLAG) === 'done') {
            if (hasLsHistory || hasLsReplays) {
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

        if (!hasLsHistory && !hasLsReplays) {
            localStorage.setItem(MIGRATION_FLAG, 'done');
            return;
        }

        logPanel('🔄 Миграция localStorage → IndexedDB...', 'info');
        let historyOk = true, replaysOk = true;
        let historyCount = 0, replaysCount = 0, historyFailed = 0, replaysFailed = 0;

        if (hasLsHistory) {
            try {
                const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
                for (const [dayKey, battles] of Object.entries(parsed)) {
                    if (!Array.isArray(battles) || battles.length === 0) continue;
                    const ok = await cwIdb.put(IDB_STORE_HISTORY, dayKey, battles);
                    if (ok) historyCount++;
                    else { historyFailed++; historyOk = false; }
                }
                if (historyOk) {
                    localStorage.removeItem(STORAGE_KEY);
                    logPanel(`  📚 История: перенесено ${historyCount} ${plural(historyCount, ['день', 'дня', 'дней'])}`, 'info');
                } else {
                    logPanel(`  ⚠️ История: перенесено ${historyCount}, ошибок: ${historyFailed} — LS НЕ удалён`, 'warn');
                }
            } catch (e) {
                historyOk = false;
                logPanel('  ❌ Ошибка миграции истории: ' + e.message, 'error');
            }
        }

        if (hasLsReplays) {
            for (const key of lsReplayKeys) {
                try {
                    const raw = localStorage.getItem(key);
                    if (!raw) continue;
                    const parsed = JSON.parse(raw);
                    let keyCount = 0, keyFailed = 0;

                    for (const [replayId, value] of Object.entries(parsed)) {
                        if (!replayId || !value) continue;
                        const ok = await cwIdb.put(IDB_STORE_REPLAYS, replayId, value);
                        if (ok) { replaysCount++; keyCount++; }
                        else { replaysFailed++; keyFailed++; replaysOk = false; }
                    }

                    if (keyFailed === 0) {
                        localStorage.removeItem(key);
                        logPanel(`  📼 Кэш реплеев [${key}]: перенесено ${keyCount} ${plural(keyCount, ['запись', 'записи', 'записей'])}`, 'info');
                    } else {
                        logPanel(`  ⚠️ Кэш реплеев [${key}]: перенесено ${keyCount}, ошибок: ${keyFailed} — LS НЕ удалён`, 'warn');
                    }
                } catch (e) {
                    replaysOk = false;
                    logPanel(`  ❌ Ошибка миграции реплеев [${key}]: ${e.message}`, 'error');
                }
            }
        }

        if (historyOk && replaysOk) {
            localStorage.setItem(MIGRATION_FLAG, 'done');
            logPanel('✅ Миграция завершена, старые LS-ключи удалены', 'success');
        } else {
            logPanel('⚠️ Миграция неполная: LS-ключи сохранены, повторим при следующем запуске', 'warn');
        }
    }

/* ================================================================
/  ИСТОРИЯ
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

    async function saveHistoryToIdb(history, changedKeys = null) {
        const allKeys = Object.keys(history).sort(compareHistoryKeys);
        const kept = allKeys.slice(0, MAX_HISTORY_DAYS);

        const existing = new Set(await cwIdb.getAllKeys(IDB_STORE_HISTORY));

        let saved = 0, cleaned = 0;
        for (const k of kept) {
            const cleanKey = k.trim();

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

        // Ключи, которых нет в kept: удаляем все
        for (const k of existing) {
            await cwIdb.delete(IDB_STORE_HISTORY, k);
        }

        if (cleaned > 0) {
            logPanel(`🧹 При сохранении очищено ${cleaned} "пустых" ${plural(cleaned, ['бой', 'боя', 'боёв'])}`, 'info');
        }
        logPanel(`💾 База истории: записано ${saved} ${plural(saved, ['день', 'дня', 'дней'])} (макс. ${MAX_HISTORY_DAYS})`, 'info');
    }

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
        const changedKeys = new Set();

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
                    time: battle.time,
                    winProbability: null,
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
            changedKeys.add(key.trim());
        }

        if (updated) await saveHistory(history, changedKeys);
        if (newBattles > 0 || skippedDuplicates > 0 || skippedEmpty > 0) {
            let msg = `📥 Новых боёв: ${newBattles}`;
            if (skippedDuplicates > 0) msg += `, дубликатов: ${skippedDuplicates}`;
            if (skippedEmpty > 0) msg += `, пустых: ${skippedEmpty}`;
            if (skippedEmptyDays > 0) msg += `, пропущено пустых дней: ${skippedEmptyDays}`;
            logPanel(msg, 'info');
        }
        return history;
    }

/* ================================================================
/  КЭШ РЕПЛЕЕВ
/ ================================================================ */
    const replayMemoryCache = new Map();
    let replayStorageCache = null;
    let replayStorageDirty = false;
    const dirtyReplayIds = new Set();

    async function loadReplayCache() {
        if (!cwIdb.available) {
            try {
                const data = localStorage.getItem(REPLAY_CACHE_KEY);
                return data ? JSON.parse(data) : {};
            } catch (e) { return {}; }
        }
        try {
            const keys = await cwIdb.getAllKeys(IDB_STORE_REPLAYS);
            const result = {};
            for (const k of keys) {
                const v = await cwIdb.get(IDB_STORE_REPLAYS, k);
                if (v) result[k] = v;
            }
            return result;
        } catch (e) {
            console.error('[HWH CW Cascade] Ошибка загрузки кэша реплеев:', e);
            return {};
        }
    }

    async function saveReplayCache(cache) {
        if (!cwIdb.available) {
            try {
                const keys = Object.keys(cache);
                if (keys.length > MAX_REPLAY_CACHE_ENTRIES) {
                    const pruned = {};
                    keys.slice(-MAX_REPLAY_CACHE_ENTRIES).forEach(k => pruned[k] = cache[k]);
                    cache = pruned;
                }
                localStorage.setItem(REPLAY_CACHE_KEY, JSON.stringify(cache));
                return true;
            } catch (e) { return false; }
        }
        try {
            if (dirtyReplayIds.size > 0) {
                for (const id of dirtyReplayIds) {
                    if (cache[id]) await cwIdb.put(IDB_STORE_REPLAYS, id, cache[id]);
                    else await cwIdb.delete(IDB_STORE_REPLAYS, id);
                }
                dirtyReplayIds.clear();
            }
            await cwIdb.pruneReplays(MAX_REPLAY_CACHE_ENTRIES);
            return true;
        } catch (e) {
            console.error('[HWH CW Cascade] Ошибка сохранения кэша реплеев:', e);
            return false;
        }
    }

    async function getReplayStorageCache() {
        if (replayStorageCache === null) replayStorageCache = await loadReplayCache();
        return replayStorageCache;
    }

    async function reloadReplayCache(force = false) {
        if (!force && replayStorageCache !== null) return;
        replayStorageCache = await loadReplayCache();
        replayMemoryCache.clear();
        for (const [k, v] of Object.entries(replayStorageCache)) replayMemoryCache.set(k, v);
        replayStorageDirty = false;
        dirtyReplayIds.clear();
        logPanel(`🔄 Кэш реплеев перечитан: ${replayMemoryCache.size} ${plural(replayMemoryCache.size, ['запись', 'записи', 'записей'])}`, 'info');
    }

    async function flushReplayCache() {
        if (replayStorageDirty && replayStorageCache) {
            const success = await saveReplayCache(replayStorageCache);
            if (success) {
                replayStorageDirty = false;
                const n = Object.keys(replayStorageCache).length;
                logPanel(`💾 Кэш реплеев сохранён: ${n} ${plural(n, ['запись', 'записи', 'записей'])}`, 'info');
            }
        }
    }

/* ================================================================
/  ЗАГРУЗКА РЕПЛЕЯ
/ ================================================================ */
    async function getReplayInfo(replayId) {
        if (replayMemoryCache.has(replayId)) {
            const cached = replayMemoryCache.get(replayId);
            if (cached?.attackers?.[0]?.units?.length || cached?.defenders?.[0]?.units?.length) return cached;
        }

        const storageCache = await getReplayStorageCache();
        const fromCache = storageCache[replayId];
        if (fromCache?.attackers?.[0]?.units?.length || fromCache?.defenders?.[0]?.units?.length) {
            replayMemoryCache.set(replayId, fromCache);
            logDebug(`📼 Реплей ${replayId}: из кэша (полный)`);
            return fromCache;
        }

        try {
            const replay = await Caller.send({ name: 'battleGetReplay', args: { id: replayId } });
            const result = { attackers: [], defenders: [] };

            const pastAttackers = replay?.replay?.attackers;
            if (pastAttackers) {
                const list = Array.isArray(pastAttackers) ? pastAttackers : Object.values(pastAttackers);
                if (list.length > 0) {
                    const sig = extractPackSignature(list);
                    if (sig) result.attackers.push({
                        teamString: sig.heroes,
                        heroes: sig.heroes, petId: sig.petId, favorStr: sig.favorStr, fullSig: sig.fullSig,
                        teamNames: getTeamNamesString(list),
                        units: extractUnitsInfo(list),
                    });
                }
            }

            const pastDefenders = replay?.replay?.defenders;
            if (pastDefenders && pastDefenders.length > 0) {
                for (const defTeam of pastDefenders) {
                    const sig = extractPackSignature(defTeam);
                    const teamType = getTeamType(defTeam);
                    if (sig && teamType) result.defenders.push({
                        teamString: sig.heroes,
                        heroes: sig.heroes, petId: sig.petId, favorStr: sig.favorStr, fullSig: sig.fullSig,
                        teamType,
                        teamNames: getTeamNamesString(defTeam),
                        units: extractUnitsInfo(defTeam),
                    });
                }
            }

            replayMemoryCache.set(replayId, result);
            storageCache[replayId] = result;
            replayStorageDirty = true;
            dirtyReplayIds.add(replayId);
            logDebug(`📼 Реплей ${replayId}: загружен с сервера и сохранён в кэш`);
            return result;
        } catch (e) {
            logPanel(`Не удалось загрузить реплей ${replayId}`, 'warn');
            return { attackers: [], defenders: [] };
        }
    }

    async function forceGetReplayUnits(replayId) {
        if (!replayId) return null;
        try {
            const fresh = await Caller.send({ name: 'battleGetReplay', args: { id: replayId } });
            const result = { attackerUnits: [], defenderUnits: [] };

            const att = fresh?.replay?.attackers;
            if (att) {
                const list = Array.isArray(att) ? att : Object.values(att);
                if (list.length > 0) result.attackerUnits = extractUnitsInfo(list);
            }
            const def = fresh?.replay?.defenders;
            if (Array.isArray(def) && def.length > 0) {
                result.defenderUnits = extractUnitsInfo(def[0]);
            }
            return result;
        } catch (e) {
            logDebug(`forceGetReplayUnits(${replayId}): ${e.message}`);
            return null;
        }
    }

/* ================================================================
/  ПРОВЕРКА ОБЪЁМА IDB
/ ================================================================ */

    async function checkStorageSize() {
        try {
            const histKeys = await cwIdb.getAllKeys(IDB_STORE_HISTORY);
            const replayKeys = await cwIdb.getAllKeys(IDB_STORE_REPLAYS);

            let ourBytes = 0;
            for (const k of histKeys) {
                const v = await cwIdb.get(IDB_STORE_HISTORY, k);
                if (v) try { ourBytes += new Blob([JSON.stringify(v)]).size; } catch (e) {}
            }
            for (const k of replayKeys) {
                const v = await cwIdb.get(IDB_STORE_REPLAYS, k);
                if (v) try { ourBytes += new Blob([JSON.stringify(v)]).size; } catch (e) {}
            }

            let totalOriginMB = '—';
            if (navigator.storage?.estimate) {
                const { usage } = await navigator.storage.estimate();
                totalOriginMB = (usage / 1024 / 1024).toFixed(2);
            }

            const ourKB = (ourBytes / 1024).toFixed(1);
            const ourMB = (ourBytes / 1024 / 1024).toFixed(2);

            console.group(`%c[HWH CW Cascade] 📊 Состояние IndexedDB`, 'color: #ffd24d; font-weight: bold');
            console.log(`📚 История: ${histKeys.length} ${plural(histKeys.length, ['день', 'дня', 'дней'])} (макс. ${MAX_HISTORY_DAYS})`);
            console.log(`📼 Кэш реплеев: ${replayKeys.length} ${plural(replayKeys.length, ['запись', 'записи', 'записей'])} (макс. ${MAX_REPLAY_CACHE_ENTRIES})`);
            console.log(`💾 Наши данные: ~${ourKB} КБ (${ourMB} МБ)`);
            console.log(`📦 Весь origin (игра + мы): ${totalOriginMB} МБ — справочно, не только наша БД`);
            console.groupEnd();
        } catch (e) {
            console.error('[HWH CW Cascade] Ошибка проверки IDB:', e);
        }
    }

    let storageInitialized = false;
    async function initStorage() {
        if (storageInitialized) return;
        await cwIdb.open();
        await migrateLocalStorageToIdb();
        await reloadReplayCache(true);
        await checkStorageSize();
        storageInitialized = true;
    }

/* ================================================================
/  БД НАЗНАЧЕНИЙ
/ ================================================================ */

    const DatabaseClass = globalThis.HWHClasses?.Database;
    if (!DatabaseClass) console.log('%c[HWH CW Cascade] ⚠️ HWHClasses.Database не найден', 'color: red');

    if (DatabaseClass && !DatabaseClass.prototype.getAll) {
        DatabaseClass.prototype.getAll = async function () {
            return new Promise((res, rej) => {
                const tx = this.db.transaction([this.storeName], 'readonly');
                const req = tx.objectStore(this.storeName).getAll();
                req.onsuccess = () => res(req.result || []);
                req.onerror = () => rej(req.error);
            });
        };
    }
    if (DatabaseClass && !DatabaseClass.prototype.getAllKeys) {
        DatabaseClass.prototype.getAllKeys = async function () {
            return new Promise((res, rej) => {
                const tx = this.db.transaction([this.storeName], 'readonly');
                const req = tx.objectStore(this.storeName).getAllKeys();
                req.onsuccess = () => res(req.result || []);
                req.onerror = () => rej(req.error);
            });
        };
    }
    if (DatabaseClass && !DatabaseClass.prototype.clear) {
        DatabaseClass.prototype.clear = async function () {
            return new Promise((res, rej) => {
                const tx = this.db.transaction([this.storeName], 'readwrite');
                const req = tx.objectStore(this.storeName).clear();
                req.onsuccess = () => res();
                req.onerror = () => rej(req.error);
            });
        };
    }

    const assignmentsDB = DatabaseClass ? new DatabaseClass('HWH_CW_Assignments', 'assignments') : null;

    const assignmentsApi = {
        ready: false,
        async init() {
            if (!assignmentsDB) return false;
            if (this.ready) return true;
            try { await assignmentsDB.open(); this.ready = true; return true; }
            catch (e) { console.warn('[HWH CW Cascade] IndexedDB назначений недоступна:', e.message); return false; }
        },

        async put(record) {
            if (!this.ready) await this.init();
            if (!this.ready) return null;

            const key = `${record.season}_${record.day}_${record.slotId}`;
            record.key = key;
            record.timestamp = record.timestamp || Date.now();
            await assignmentsDB.set(key, record);
            return record;
        },

        async getByDate(season, day) {
            if (!this.ready) await this.init();
            if (!this.ready) return [];
            const all = await assignmentsDB.getAll();
            return all.filter(r => {
                if (!r) return false;
                const recMode = r.mode || WAR_MODE_CLAN;
                if (recMode !== WAR_MODE_CLAN) return false;
                return String(r.season) === String(season) && String(r.day) === String(day);
            });
        },

        async getAll() {
            if (!this.ready) await this.init();
            if (!this.ready) return [];
            return await assignmentsDB.getAll();
        },

        async deleteOld(daysToKeep = 90) {
            if (!this.ready) await this.init();
            if (!this.ready) return 0;
            const cutoff = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;
            const all = await assignmentsDB.getAll();
            let deleted = 0;
            for (const r of all) {
                if (r && r.timestamp && r.timestamp < cutoff && r.key) {
                    try { await assignmentsDB.delete(r.key); deleted++; } catch (e) {}
                }
            }
            return deleted;
        },
    };

/* ============================================================
 * ВГ: нормализация, парсинг попыток, API
 * ============================================================ */

    function normalizeClanWarInfo(cw) {
        if (!cw || !cw.season || !cw.enemySlots) return null;
        if (Object.keys(cw.enemySlots).length === 0) return null;
        return {
            season: cw.season,
            day: cw.day,
            enemySlots: cw.enemySlots,
            ourSlots: cw.ourSlots || {},
            clanTries: cw.clanTries || {},
            myTries: cw.myTries ?? 0,
            league: cw.league,
            ourClanMembers: cw.ourClanMembers || {},
            enemyClanMembers: cw.enemyClanMembers || {},
            raw: cw,
        };
    }

    function parseClanTries(raw) {
        const def = { heroes: 0, titans: 0 };
        if (raw == null) return def;
        if (typeof raw === 'number') return { heroes: raw, titans: 0 };
        if (typeof raw === 'string') return { heroes: parseInt(raw) || 0, titans: 0 };
        if (typeof raw !== 'object') return def;

        const pickNum = (...keys) => {
            for (const k of keys) {
                if (typeof raw[k] === 'number') return raw[k];
            }
            return 0;
        };

        return {
            heroes: pickNum('heroes', 'hero', 'amount', 'tries', 'value', 'count'),
            titans: pickNum('titans', 'titan'),
        };
    }

    function getSlotType(teamUnits) {
        if (!Array.isArray(teamUnits) || teamUnits.length === 0) return 'hero';
        for (const u of teamUnits) {
            if (u?.type === 'titan') return 'titan';
        }
        for (const u of teamUnits) {
            if (u?.type === 'hero') return 'hero';
        }
        for (const u of teamUnits) {
            const n = +u?.id;
            if (n >= 4000 && n < 5000) return 'titan';
            if (n > 0 && n < 1000) return 'hero';
        }
        return 'hero';
    }

    async function detectActiveWarModes() {
        try {
            const cw = await Caller.send('clanWarGetInfo');
            const norm = normalizeClanWarInfo(cw);
            if (norm) {
                logPanel(`🏰 ВГ активна (сезон ${norm.season}, день ${norm.day}, попытки ${norm.myTries})`, 'info');
                return [norm];
            }
            logDebug('ВГ не активна (normalizeClanWarInfo вернул null)');
        } catch (e) {
            logDebug('ВГ не активна: ' + e.message);
        }
        return [];
    }

    async function setTargetMark(userId, slotId) {
        try {
            const r = await Caller.send({ name: 'clanWarSetTargetMark', args: { userId, slotId } });
            if (r === null || r === undefined) return { ok: true, error: null };
            if (r.error) return { ok: false, error: r.error };
            return { ok: true, error: null };
        } catch (e) {
            return { ok: false, error: e.message || 'Exception' };
        }
    }

/* ================================================================
/  ПРОВЕРКА РАЗМЕРА БД НАЗНАЧЕНИЙ + АРХИВАЦИЯ
/ ================================================================ */
    async function checkAndArchiveAssignments(silent = false) {
        try {
            if (!assignmentsApi.ready) await assignmentsApi.init();
            if (!assignmentsApi.ready) {
                if (!silent) await popup.confirm(
                    '❌ IndexedDB недоступна.<br>Проверьте, что браузер не в приватном режиме и не блокирует хранилище.',
                    [{ msg: 'Ок', result: 0, color: 'green' }]
                );
                return;
            }

            const allRaw = await assignmentsApi.getAll();
            const all = allRaw.filter(r => r && (r.mode || WAR_MODE_CLAN) === WAR_MODE_CLAN);
            const legacyCount = allRaw.length - all.length;

            let jsonSize = 0;
            try { jsonSize = new Blob([JSON.stringify(allRaw)]).size; }
            catch (e) { jsonSize = allRaw.length * 2048; }
            const sizeMB = jsonSize / (1024 * 1024);

            const fmt = (b) => b < 1024 ? b + ' Б' : b < 1048576 ? (b / 1024).toFixed(2) + ' КБ' : (b / 1048576).toFixed(2) + ' МБ';

            const byDay = {}, byMember = {}, byLevel = {};
            let oldest = null, newest = null;
            for (const r of all) {
                const dayKey = `ВГ ${r.season}/${r.day}`;
                byDay[dayKey] = (byDay[dayKey] || 0) + 1;
                byMember[r.memberId] = (byMember[r.memberId] || 0) + 1;
                byLevel[r.matchLevel] = (byLevel[r.matchLevel] || 0) + 1;
                if (r.timestamp) {
                    if (!oldest || r.timestamp < oldest) oldest = r.timestamp;
                    if (!newest || r.timestamp > newest) newest = r.timestamp;
                }
            }

            const levelLabel = {
                exact: '✅ exact',
                sameDefenderMinor: '⚠️ ~пит',
                otherDefenderExact: '🔄 ≠ID',
                otherDefenderMinor: '🔄⚠️ ≠ID~пит',
            };

            let html = `<div style="text-align:left;font-size:13px;line-height:1.5;">`;
            html += `<div style="color:#ffd24d;font-weight:bold;font-size:14px;margin-bottom:8px;">📊 IndexedDB "HWH_CW_Assignments"</div>`;

            if (all.length === 0 && legacyCount === 0) {
                html += `<div style="color:#ff8a80;padding:12px;border:1px solid #8a6d3b;border-radius:6px;">📭 База пуста.<br>Запустите «🎯 Авто-цели ВГ».</div>`;
            } else {
                html += `<div style="padding:8px;border:1px solid #8a6d3b;border-radius:6px;margin-bottom:8px;">`;
                html += `<div><b>Записей ВГ:</b> ${all.length.toLocaleString('ru-RU')}</div>`;
                html += `<div><b>Размер (все записи):</b> ${fmt(jsonSize)} (${sizeMB.toFixed(2)} МБ)</div>`;
                html += `<div><b>Порог предупреждения:</b> ${ASSIGNMENTS_SIZE_WARN_MB} МБ ${sizeMB > ASSIGNMENTS_SIZE_WARN_MB ? '⚠️ превышен' : '✅ в норме'}</div>`;
                html += `<div><b>Порог архивации:</b> ${ASSIGNMENTS_ARCHIVE_THRESHOLD_MB} МБ ${sizeMB > ASSIGNMENTS_ARCHIVE_THRESHOLD_MB ? '⚠️ превышен' : '✅ в норме'}</div>`;
                html += `<div><b>Срок хранения:</b> ${KEEP_ASSIGNMENTS_DAYS} дней</div>`;
                if (oldest) html += `<div><b>Самая старая:</b> ${new Date(oldest).toLocaleString('ru-RU')}</div>`;
                if (newest) html += `<div><b>Самая свежая:</b> ${new Date(newest).toLocaleString('ru-RU')}</div>`;
                html += `</div>`;

                if (all.length > 0) {
                    const days = Object.keys(byDay).sort().reverse();
                    html += `<div style="padding:8px;border:1px solid #8a6d3b;border-radius:6px;margin-bottom:8px;">`;
                    html += `<div style="color:#ffd24d;font-weight:bold;margin-bottom:4px;">📅 По дням (${days.length}):</div>`;
                    for (const d of days.slice(0, 15)) {
                        html += `<div>• ${d}: ${byDay[d]} ${plural(byDay[d], ['запись', 'записи', 'записей'])}</div>`;
                    }
                    if (days.length > 15) {
                        const more = days.length - 15;
                        html += `<div style="color:#888;">... и ещё ${more} ${plural(more, ['день', 'дня', 'дней'])}</div>`;
                    }
                    html += `</div>`;
                }

                if (Object.keys(byLevel).length > 0) {
                    html += `<div style="padding:8px;border:1px solid #8a6d3b;border-radius:6px;margin-bottom:8px;">`;
                    html += `<div style="color:#ffd24d;font-weight:bold;margin-bottom:4px;">🎯 По уровням каскада:</div>`;
                    for (const lvl in levelLabel) if (byLevel[lvl]) html += `<div>• ${levelLabel[lvl]}: ${byLevel[lvl]}</div>`;
                    html += `</div>`;
                }

                const members = Object.entries(byMember).sort((a, b) => b[1] - a[1]).slice(0, 10);
                if (members.length > 0) {
                    html += `<div style="padding:8px;border:1px solid #8a6d3b;border-radius:6px;">`;
                    html += `<div style="color:#ffd24d;font-weight:bold;margin-bottom:4px;">👥 Топ игроков (${Object.keys(byMember).length}):</div>`;
                    for (const [mId, count] of members) {
                        const name = all.find(r => String(r.memberId) === String(mId))?.memberName || mId;
                        html += `<div>• ${name}: ${count}</div>`;
                    }
                    html += `</div>`;
                }
            }
            html += `</div>`;

            if (!silent) {
                const buttons = [{ msg: 'Ок', result: 0, color: 'green' }];
                if (all.length > 0 && sizeMB >= ASSIGNMENTS_ARCHIVE_THRESHOLD_MB) {
                    buttons.unshift({ msg: '📦 Архивировать сейчас', result: 'archive', color: 'orange' });
                }
                const answer = await popup.confirm(html, buttons);
                if (answer === 'archive') await archiveAssignments();
            }

            if (all.length > 0 && sizeMB > ASSIGNMENTS_SIZE_WARN_MB) {
                logPanel(`📊 БД назначений: ${all.length} записей, ~${sizeMB.toFixed(1)} МБ (порог ${ASSIGNMENTS_SIZE_WARN_MB} МБ превышен)`, 'warn');
            } else if (all.length > 0) {
                logDebug(`📊 БД назначений: ${all.length} записей, ~${sizeMB.toFixed(1)} МБ — в норме`);
            }

            if (sizeMB >= ASSIGNMENTS_ARCHIVE_THRESHOLD_MB) await archiveAssignments();
        } catch (e) {
            console.error('[HWH CW Cascade] checkAndArchiveAssignments error:', e);
            if (!silent) await popup.confirm(`❌ Ошибка проверки БД:<br>${e.message}`, [{ msg: 'Ок', result: 0, color: 'green' }]);
        }
    }

    async function archiveAssignments() {
        if (!assignmentsApi.ready) await assignmentsApi.init();
        if (!assignmentsApi.ready) return;

        const allRaw = await assignmentsApi.getAll();
        const all = allRaw.filter(r => r && typeof r === 'object');
        const cutoff = Date.now() - ASSIGNMENTS_ARCHIVE_OLDER_THAN_DAYS * 24 * 60 * 60 * 1000;
        const old = all.filter(r => r && r.timestamp && r.timestamp < cutoff);
        if (old.length === 0) {
            await popup.confirm(`Нет записей старше ${ASSIGNMENTS_ARCHIVE_OLDER_THAN_DAYS} дней — архивировать нечего.`,
                                [{ msg: 'Ок', result: 0, color: 'green' }]);
            return;
        }

        try {
            const payload = {
                version: 1, archivedAt: new Date().toISOString(),
                reason: 'manual-or-auto-archive',
                scriptVersion: GM_info.script.version,
                totalRecords: old.length, records: old,
            };
            const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `hwh_cw_archive_${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            URL.revokeObjectURL(url);
            logPanel(`📦 Архив: ${old.length} ${plural(old.length, ['запись', 'записи', 'записей'])}, ${(blob.size / 1024).toFixed(1)} КБ`, 'success');

            let deleted = 0;
            for (const r of old) {
                if (r.key) { try { await assignmentsDB.delete(r.key); deleted++; } catch (e) {} }
            }
            const left = all.length - deleted;
            logPanel(`🧹 Удалено: ${deleted} ${plural(deleted, ['запись', 'записи', 'записей'])}, осталось: ${left}`, 'info');
            await popup.confirm(
                `✅ Архив сохранён: ${old.length} записей (${(blob.size / 1024).toFixed(1)} КБ).<br>` +
                `Удалено из БД: ${deleted}.<br>Осталось: ${left}.`,
                [{ msg: 'Ок', result: 0, color: 'green' }]
            );
        } catch (e) {
            logPanel(`❌ Ошибка архивации: ${e.message}`, 'error');
        }
    }

/* ================================================================
/  УТИЛИТЫ ПАЧЕК
/ ================================================================ */
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
        } catch (e) {}
        if (!name) {
            try {
                if (typeof lib !== 'undefined' && lib.data?.hero?.[id]) {
                    const heroData = lib.data.hero[id];
                    if (typeof cheats !== 'undefined' && typeof cheats.translate === 'function') {
                        const translated = cheats.translate(heroData.name || `LIB_HERO_NAME_${id}`);
                        if (translated && !translated.startsWith('LIB_HERO_NAME_')) name = translated;
                    }
                }
            } catch (e) {}
        }
        if (!name) name = `ID:${id}`;
        heroNameCache.set(id, name);
        return name;
    }

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
            const map = {
                31: 'Ак.Магов-3', 32: 'Маяк-3', 33: 'Казармы-3', 34: 'Мост-4', 35: 'Источник-4',
                36: 'Литейная-4', 37: 'Врата-4', 38: 'Баст.Огня-4', 39: 'Баст.Льда-4', 40: 'Цитадель-7'
            };
            if (map[slotId]) location = map[slotId];
        }
        return `${location} (#${slotId})`;
    }

    function getTeamType(team) {
        if (!team) return null;
        let units = Array.isArray(team) ? team : Object.values(team);
        units = units.filter(u => u && typeof u === 'object');
        if (units.length === 0) return null;
        for (const u of units) {
            if (u.type) return u.type;
        }
        for (const u of units) {
            if (u.id) {
                const n = +u.id;
                if (n >= 6000 && n < 7000) return 'pet';
                if (n >= 4000 && n < 5000) return 'titan';
                if (n > 0 && n < 1000) return 'hero';
            }
        }
        return null;
    }

    function extractSlotTeam(slotData) {
        const t = slotData?.team;
        if (!t) return null;

        const collectUnits = (source, depth = 0) => {
            if (!source || depth > 3) return [];
            const out = [];

            const pushUnit = (u) => {
                if (!u || typeof u !== 'object') return;
                if (u.id != null) { out.push(u); return; }
                for (const v of Object.values(u)) pushUnit(v);
            };

            if (Array.isArray(source)) {
                for (const item of source) collectUnits(item, depth + 1).forEach(u => out.push(u));
                return out;
            }
            if (typeof source === 'object') {
                for (const k of ['units', 'members', 'heroes', 'hero', 'titans', 'titan', 'pets', 'pet']) {
                    if (Array.isArray(source[k])) source[k].forEach(u => pushUnit(u));
                }
                if (out.length > 0) return out;

                const values = Object.values(source);
                for (const v of values) {
                    if (Array.isArray(v)) v.forEach(u => pushUnit(u));
                    else pushUnit(v);
                }
                return out;
            }
            return out;
        };

        const units = collectUnits(t);
        return units.length > 0 ? units.filter(u => u.id != null) : null;
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
            return u.petId ? `${name} (${getHeroName(u.petId)})` : name;
        }).join(', ');
    }

    function extractUnitsInfo(team) {
        if (!team) return [];
        let units = [];
        if (Array.isArray(team)) units = team;
        else if (typeof team === 'object') units = Object.values(team);

        return units
            .filter(u => u && u.id)
            .map(u => ({
            id: u.id,
            name: getHeroName(u.id),
            type: u.type || null,
            level: u.level || null,
            star: u.star || null,
            color: u.color || null,
            power: u.power || null,
            petId: u.petId || null,
            favorPetId: u.favorPetId || null,
        }))
            .sort((a, b) => a.id - b.id);
    }

    function extractPackSignature(team) {
        if (!team) return null;
        let units = [];
        if (Array.isArray(team)) units = team;
        else if (typeof team === 'object') units = Object.values(team);
        units = units.filter(u => u && u.id);
        if (units.length === 0) return null;

        const heroIds = units.map(u => +u.id).sort((a, b) => a - b);
        const heroes = heroIds.join(',');

        let petId = null;
        for (const u of units) {
            if (u.petId && +u.petId > 0) { petId = +u.petId; break; }
        }

        const favor = {};
        for (const u of units) {
            if (u.favorPetId && +u.favorPetId > 0) favor[u.id] = +u.favorPetId;
        }
        const favorStr = Object.keys(favor)
        .map(h => +h).sort((a, b) => a - b)
        .map(h => `${h}:${favor[h]}`).join(',');

        return { heroes, petId, favor, favorStr, fullSig: `${heroes}|${petId || ''}|${favorStr}` };
    }

    function getTeamSignature(team) {
        const sig = extractPackSignature(team);
        return sig ? sig.heroes : '';
    }

/* ================================================================
/  ПАНЕЛЬ
/ ================================================================ */
    let panel = null, panelLog = null, panelProgress = null, panelTitle = null;
    let panelMinimized = false;
    let autoCloseTimer = null;
    let autoCloseInterval = null;
    let autoCloseCountdownLine = null;
    let altBtn = null;
    let enrichBtn = null;
    let replayLoadRunning = false;
    let replayLoadCancelFlag = false;

    function cancelAutoClose(userInitiated = false) {
        const hadTimer = autoCloseTimer || autoCloseInterval || autoCloseCountdownLine;
        if (autoCloseTimer) { clearTimeout(autoCloseTimer); autoCloseTimer = null; }
        if (autoCloseInterval) { clearInterval(autoCloseInterval); autoCloseInterval = null; }
        if (autoCloseCountdownLine && autoCloseCountdownLine.parentNode) {
            autoCloseCountdownLine.remove();
        }
        autoCloseCountdownLine = null;
        if (hadTimer && userInitiated && panelLog) {
            logPanel('⏱️ Автозакрытие отменено (взаимодействие с панелью)', 'info');
        }
    }

    function createPanel() {
        if (panel) return;

        if (!document.getElementById('hwh-cw-panel-style')) {
            const style = document.createElement('style');
            style.id = 'hwh-cw-panel-style';
            style.textContent = `
.hwh-cw-panel{position:fixed;top:20px;right:20px;width:450px;max-height:70vh;background:rgba(30,25,18,.95);border:2px solid #8a6d3b;border-radius:8px;color:#f3e3bd;font-family:Arial,sans-serif;font-size:12px;z-index:2147483000;box-shadow:0 4px 20px rgba(0,0,0,.5);display:flex;flex-direction:column;pointer-events:auto}
.hwh-cw-panel.minimized{max-height:36px;overflow:hidden}
.hwh-cw-panel-header{display:flex;justify-content:space-between;align-items:center;padding:6px 10px;background:#3d2e1a;border-bottom:1px solid #8a6d3b;border-radius:6px 6px 0 0;cursor:move;user-select:none}
.hwh-cw-panel-title{font-weight:bold;font-size:13px;color:#ffd24d}
.hwh-cw-panel-controls{display:flex;gap:4px}
.hwh-cw-panel-btn{background:#5a4628;border:1px solid #8a6d3b;color:#f3e3bd;width:22px;height:22px;border-radius:3px;cursor:pointer;font-size:12px;line-height:1;padding:0}
.hwh-cw-panel-btn:hover{background:#7a5f38}
.hwh-cw-panel-btn.close:hover{background:#a8322b}
.hwh-cw-panel-btn:disabled{opacity:.4;cursor:not-allowed}
.hwh-cw-panel-body{flex:1;overflow-y:auto;padding:8px;max-height:calc(70vh - 80px)}
.hwh-cw-panel-progress{height:6px;background:#1a140d;border-top:1px solid #8a6d3b;border-bottom:1px solid #8a6d3b}
.hwh-cw-panel-progress-bar{height:100%;width:0;background:linear-gradient(90deg,#3d8f2f,#5cb85c);transition:width .2s}
.hwh-cw-log-line{padding:2px 4px;margin:1px 0;border-radius:2px;line-height:1.3;word-wrap:break-word}
.hwh-cw-log-line.info{color:#b8d4e3}
.hwh-cw-log-line.success{color:#7fff7f;background:rgba(61,143,47,.15)}
.hwh-cw-log-line.warn{color:#ffd24d}
.hwh-cw-log-line.error{color:#ff8a80;background:rgba(168,50,43,.15)}
.hwh-cw-log-line.highlight{color:#fff;background:rgba(138,109,59,.3);font-weight:bold}
.hwh-cw-log-line.team-names{color:#ffd24d;font-style:italic;font-size:11px;padding-left:12px}
        `;
            document.head.appendChild(style);
        }

        panel = document.createElement('div');
        panel.className = 'hwh-cw-panel';
        panel.addEventListener('mousedown', () => cancelAutoClose(true));
        panel.addEventListener('mouseenter', () => cancelAutoClose(true));

        const header = document.createElement('div');
        header.className = 'hwh-cw-panel-header';

        panelTitle = document.createElement('div');
        panelTitle.className = 'hwh-cw-panel-title';
        panelTitle.textContent = '🎯 Авто-цели ВГ (каскад)';

        const controls = document.createElement('div');
        controls.className = 'hwh-cw-panel-controls';

        const actionBtn = document.createElement('button');
        actionBtn.className = 'hwh-cw-panel-btn';
        actionBtn.textContent = '🎯';
        actionBtn.title = 'Меню действий (Авто-цели)';
        actionBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            cancelAutoClose();
            showMainActionMenu();
        });
        controls.appendChild(actionBtn);

        const exportBtn = document.createElement('button');
        exportBtn.className = 'hwh-cw-panel-btn';
        exportBtn.textContent = '💾';
        exportBtn.title = 'Бэкап: история + кэш реплеев + назначения';
        exportBtn.addEventListener('click', (e) => { e.stopPropagation(); cancelAutoClose(); exportHistory(); });
        controls.appendChild(exportBtn);

        const importBtn = document.createElement('button');
        importBtn.className = 'hwh-cw-panel-btn';
        importBtn.textContent = '📂';
        importBtn.title = 'Импорт бэкапа (с мержем)';
        importBtn.addEventListener('click', (e) => { e.stopPropagation(); cancelAutoClose(); importHistory(); });
        controls.appendChild(importBtn);

        altBtn = document.createElement('button');
        altBtn.className = 'hwh-cw-panel-btn';
        altBtn.textContent = '⚔️';
        altBtn.title = 'Альтернативные назначения';
        altBtn.disabled = true;
        controls.appendChild(altBtn);

        enrichBtn = document.createElement('button');
        enrichBtn.className = 'hwh-cw-panel-btn';
        if (replayLoadRunning) {
            enrichBtn.textContent = '⏹️';
            enrichBtn.title = 'Остановить загрузку реплеев';
        } else {
            enrichBtn.textContent = '🔧';
            enrichBtn.title = 'Загрузить все реплеи (повторное нажатие — остановка загрузки)';
        }
        enrichBtn.addEventListener('click', async (e) => {
            e.stopPropagation(); cancelAutoClose();
            await toggleReplayLoad();
        });
        controls.appendChild(enrichBtn);

        const showBtn = document.createElement('button');
        showBtn.className = 'hwh-cw-panel-btn';
        showBtn.textContent = '📋';
        showBtn.title = 'Все назначения';
        showBtn.addEventListener('click', async (e) => {
            e.stopPropagation(); cancelAutoClose();
            if (window.__hwhCWLastInfo && window.__hwhCWLastInfo.mode !== 'crossClanWar') {
                const i = window.__hwhCWLastInfo;
                await showTodayAssignments(i.season, i.day);
            } else {
                logPanel('⚠️ Сначала запустите назначение', 'warn');
            }
        });
        controls.appendChild(showBtn);

        const myBtn = document.createElement('button');
        myBtn.className = 'hwh-cw-panel-btn';
        myBtn.textContent = '📌';
        myBtn.title = 'Мои невыполненные назначения';
        myBtn.addEventListener('click', async (e) => {
            e.stopPropagation(); cancelAutoClose();
            if (!window.__hwhCWLastInfo || window.__hwhCWLastInfo.mode === 'crossClanWar') {
                logPanel('⚠️ Сначала запустите назначение', 'warn'); return;
            }
            const { season, day } = window.__hwhCWLastInfo;
            const { pending, completed, reassigned } = await getMyPendingAssignments(season, day);
            if (pending.length === 0 && reassigned.length === 0) {
                let msg = 'У вас нет невыполненных назначений.';
                if (completed.length > 0) msg += `<br>Выполнено: ${completed.length}.`;
                await popup.confirm(msg, [{ msg: 'Ок', result: 0, color: 'green' }]);
                return;
            }
            const total = pending.length + completed.length;
            const html = buildAssignmentsHtml(pending, season, day, total, reassigned, true);

            const buttons = [];
            if (pending.length > 0) {
                buttons.push({ msg: '📋 Скопировать', result: 'copy', color: 'green' });
            }
            buttons.push({ msg: 'Ок', result: 'ok', isCancel: true });

            const answer = await popup.confirm(html, buttons);
            if (answer === 'copy') copyAssignmentsToClipboard(pending, season, day);
        });
        controls.appendChild(myBtn);

        const exportAssignBtn = document.createElement('button');
        exportAssignBtn.className = 'hwh-cw-panel-btn';
        exportAssignBtn.textContent = '📤';
        exportAssignBtn.title = 'Экспорт назначений в файл';
        exportAssignBtn.addEventListener('click', (e) => { e.stopPropagation(); cancelAutoClose(); exportAssignments(); });
        controls.appendChild(exportAssignBtn);

        const sizeBtn = document.createElement('button');
        sizeBtn.className = 'hwh-cw-panel-btn';
        sizeBtn.textContent = '📊';
        sizeBtn.title = 'Размер IndexedDB + архивация';
        sizeBtn.addEventListener('click', async (e) => { e.stopPropagation(); cancelAutoClose(); await checkAndArchiveAssignments(); });
        controls.appendChild(sizeBtn);

const settingsBtn = document.createElement('button');
settingsBtn.className = 'hwh-cw-panel-btn';
settingsBtn.textContent = '⚙️';
settingsBtn.title = 'Настройки';
settingsBtn.addEventListener('click', async (e) => {
    e.stopPropagation(); cancelAutoClose();
    await showSettings();
});
controls.appendChild(settingsBtn);

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
        controls.appendChild(minBtn);

        const closeBtn = document.createElement('button');
        closeBtn.className = 'hwh-cw-panel-btn close';
        closeBtn.textContent = '✕';
        closeBtn.title = 'Закрыть';
        closeBtn.addEventListener('click', (e) => { e.stopPropagation(); destroyPanel(); });
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
        if (panel) {
            panel.remove();
            panel = null; panelLog = null; panelProgress = null; panelTitle = null;
            altBtn = null; enrichBtn = null;
        }
    }

    function makeDraggable(element, handle) {
        let offsetX = 0, offsetY = 0, isDragging = false;
        handle.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'BUTTON') return;
            cancelAutoClose(true);
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
        const m = type === 'error' ? console.error : type === 'warn' ? console.warn : console.log;
        m(`[HWH CW Cascade] ${message}`);
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
        if (args.length > 0) console.log(`[HWH CW Cascade][DEBUG] ${message}`, ...args);
        else console.log(`%c[HWH CW Cascade][DEBUG] ${message}`, 'color: #888; font-style: italic;');
    }

    function logTeamNames(prefix, namesString) {
        if (!panelLog) createPanel();
        const line = document.createElement('div');
        line.className = 'hwh-cw-log-line team-names';
        line.textContent = `${prefix}${namesString}`;
        panelLog.appendChild(line);
        while (panelLog.children.length > 300) panelLog.removeChild(panelLog.firstChild);
        panelLog.scrollTop = panelLog.scrollHeight;
        console.log(`[HWH CW Cascade] ${prefix}${namesString}`);
    }

    function logTeamDetails(prefix, units) {
        if (!units || units.length === 0) return;
        const parts = units.map(u => {
            const p = [u.name || `ID:${u.id}`];
            if (u.level) p.push(`L${u.level}`);
            if (u.star) p.push(`★${u.star}`);
            if (u.power) p.push(`${Math.round(u.power / 1000)}k`);
            if (u.petId) p.push(`(${getHeroName(u.petId)})`);
            return p.join(' ');
        });
        logTeamNames(prefix, parts.join(', '));
    }

    function setProgress(percent) {
        if (panelProgress) panelProgress.style.width = Math.max(0, Math.min(100, percent)) + '%';
    }

    function setPanelTitle(text) {
        if (panelTitle) panelTitle.textContent = text;
    }

    function scheduleAutoClose() {
        cancelAutoClose();
        if (!panelLog) createPanel();

        autoCloseCountdownLine = document.createElement('div');
        autoCloseCountdownLine.className = 'hwh-cw-log-line info';
        panelLog.appendChild(autoCloseCountdownLine);

        let remaining = AUTO_CLOSE_DELAY_SECONDS;

        const render = () => {
            if (!autoCloseCountdownLine) return;
            if (remaining > 1) {
                autoCloseCountdownLine.className = 'hwh-cw-log-line info';
                autoCloseCountdownLine.textContent = `⏱️ Панель закроется через ${remaining} сек... (клик или наведение отменят)`;
            } else {
                autoCloseCountdownLine.className = 'hwh-cw-log-line error';
                autoCloseCountdownLine.textContent = `⏱️ Панель закроется через 1 сек...`;
            }
            panelLog.scrollTop = panelLog.scrollHeight;
        };

        render();

        autoCloseInterval = setInterval(() => {
            remaining--;
            if (remaining > 0) render();
        }, 1000);

        autoCloseTimer = setTimeout(() => {
            clearInterval(autoCloseInterval);
            autoCloseInterval = null;
            if (autoCloseCountdownLine) {
                autoCloseCountdownLine.className = 'hwh-cw-log-line error';
                autoCloseCountdownLine.textContent = `⏱️ Всё, я закрываюсь...`;
                panelLog.scrollTop = panelLog.scrollHeight;
            }
            autoCloseTimer = setTimeout(() => {
                autoCloseTimer = null;
                if (panel) destroyPanel();
            }, 1000);
        }, AUTO_CLOSE_DELAY_SECONDS * 1000);
    }

    async function logReplayCacheStats() {
        try {
            const cache = await getReplayStorageCache();
            let total = 0, full = 0, partial = 0;
            for (const rid in cache) {
                total++;
                const d = cache[rid];
                const hasA = d?.attackers?.[0]?.units?.length > 0;
                const hasD = d?.defenders?.[0]?.units?.length > 0;
                if (hasA && hasD) full++;
                else partial++;
            }
            let histDays = 0;
            try { histDays = (await cwIdb.getAllKeys(IDB_STORE_HISTORY)).length; } catch (e) {}
            const type = partial > 0 ? 'warn' : 'info';
            logPanel(
                `📊 Состояние БД: дней в истории — ${histDays}, ` +
                `реплеев — ${total} (полных: ${full}, неполных: ${partial})`,
                type
            );
            return { total, full, partial, histDays };
        } catch (e) {
            logDebug('logReplayCacheStats: ' + e.message);
            return { total: 0, full: 0, partial: 0, histDays: 0 };
        }
    }

/* ================================================================
/  ИНДЕКС ПАЧЕК
/ ================================================================ */
    async function buildPackIndex(mergedHistory, maxNew = 100, checkCancel = null) {
        const idxByHeroes          = new Map();
        const idxByFull            = new Map();
        const defenderIdxByHeroes  = new Map();
        const defenderIdxByFull    = new Map();

        let newLoads = 0, fromStorage = 0, skippedNoData = 0, enrichedCount = 0;
        let cancelled = false;
        const enrichedKeys = new Set();

        const addTo = (index, key, attackerId, defenderId, packInfo, attackerInfo, replayId, ts, winProb) => {
            if (!index.has(key)) index.set(key, new Map());
            const m = index.get(key);
            if (!m.has(attackerId)) {
                m.set(attackerId, {
                    wins: 0, lastReplayId: null, lastTimestamp: 0,
                    winProbability: null,
                    attackerNames: '', defenderNames: '',
                    attackerUnits: [], defenderUnits: [],
                    byDefender: new Map(),
                });
            }
            const e = m.get(attackerId);
            e.wins++;
            if (ts > e.lastTimestamp || !e.lastReplayId) {
                e.lastReplayId = replayId;
                e.lastTimestamp = ts;
                e.attackerNames = attackerInfo.teamNames || '';
                e.defenderNames = packInfo.teamNames || '';
                e.attackerUnits = attackerInfo.units || [];
                e.defenderUnits = packInfo.units || [];
                if (typeof winProb === 'number') e.winProbability = winProb;
            }
            if (!e.byDefender.has(defenderId)) e.byDefender.set(defenderId, { wins: 0, lastReplayId: null });
            const bd = e.byDefender.get(defenderId);
            bd.wins++;
            bd.lastReplayId = replayId;
        };

        let totalFullWins = 0;
        for (const [dayKey, battles] of Object.entries(mergedHistory)) {
            if (dayKey.startsWith('sm_')) continue;
            for (const b of battles) if (isFullWin(b) && !isEmptyBattle(b)) totalFullWins++;
        }
        logPanel(`🔍 Анализ ${totalFullWins} ${plural(totalFullWins, ['победы', 'побед', 'побед'])}...`, 'info');
        let lastProgressPct = 0;

        for (const [dayKey, battles] of Object.entries(mergedHistory)) {
            if (dayKey.startsWith('sm_')) continue;
            if (cancelled) break;
            for (const b of battles) {
                if (checkCancel && checkCancel()) { cancelled = true; break; }
                if (!isFullWin(b) || isEmptyBattle(b)) continue;
                let ri = null, defenders = [];

                const packsHaveUnits =
                      Array.isArray(b.defenderPacks) &&
                      b.defenderPacks.length > 0 &&
                      b.defenderPacks.some(p => Array.isArray(p.units) && p.units.length > 0);

                if (packsHaveUnits) {
                    fromStorage++;
                    if (replayMemoryCache.has(b.replayId)) {
                        const m = replayMemoryCache.get(b.replayId);
                        if (m?.attackers?.[0]?.units?.length && m?.defenders?.[0]?.units?.length) ri = m;
                    }
                    if (!ri) {
                        const sc = await getReplayStorageCache();
                        const c = sc[b.replayId];
                        if (c?.attackers?.[0]?.units?.length && c?.defenders?.[0]?.units?.length) {
                            ri = c;
                            replayMemoryCache.set(b.replayId, ri);
                        }
                    }
                    if (!ri) {
                        ri = await getReplayInfo(b.replayId);
                        if (ri?.attackers?.[0]?.units?.length && ri?.defenders?.[0]?.units?.length) {
                            b.defenderPacks = ri.defenders.map(d => ({
                                teamType: d.teamType, teamString: d.teamString,
                                petId: d.petId, favorStr: d.favorStr, fullSig: d.fullSig,
                                units: d.units || [],
                            }));
                            enrichedCount++;
                            enrichedKeys.add(dayKey.trim());
                            newLoads++;
                        }
                    }
                    defenders = b.defenderPacks;
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
                            teamType: d.teamType, teamString: d.teamString,
                            petId: d.petId, favorStr: d.favorStr, fullSig: d.fullSig,
                            units: d.units || [],
                        }));
                        enrichedCount++;
                        enrichedKeys.add(dayKey.trim());
                    }
                    await sleep(100);
                }

                const attackerInfo = ri?.attackers?.[0] || {};
                const ts = b.time ? new Date(b.time).getTime() : 0;
                const wp = (typeof b.winProbability === 'number') ? b.winProbability : null;

                for (const d of defenders) {
                    if (!d.fullSig) {
                        d.heroes = d.heroes || d.teamString;
                        d.petId = d.petId || null;
                        d.favorStr = d.favorStr || '';
                        d.fullSig = `${d.heroes}|${d.petId || ''}|${d.favorStr}`;
                    }
                    const heroes = d.heroes || d.teamString;
                    addTo(idxByHeroes,          `${d.teamType}|${heroes}`,              b.attackerId, b.defenderId, d, attackerInfo, b.replayId, ts, wp);
                    addTo(idxByFull,            `${d.teamType}|${d.fullSig}`,           b.attackerId, b.defenderId, d, attackerInfo, b.replayId, ts, wp);
                    addTo(defenderIdxByHeroes,  `${b.defenderId}|${d.teamType}|${heroes}`,    b.attackerId, b.defenderId, d, attackerInfo, b.replayId, ts, wp);
                    addTo(defenderIdxByFull,    `${b.defenderId}|${d.teamType}|${d.fullSig}`,  b.attackerId, b.defenderId, d, attackerInfo, b.replayId, ts, wp);
                }
            }
        }

        logPanel(`🔍 Индексы: heroes=${idxByHeroes.size}, full=${idxByFull.size}, defH=${defenderIdxByHeroes.size}, defF=${defenderIdxByFull.size} (из базы: ${fromStorage}, загружено: ${newLoads})`, 'info');

        if (cancelled) {
            logPanel('⏹️ Загрузка реплеев остановлена', 'warn');
        } else if (skippedNoData > 0) {
            logPanel(
            `⚠️ Сработало ограничение на единовременную загрузку реплеев: ${maxNew}. ` +
            `Не все реплеи догрузились, остались необновлённые записи. ` +
            `Запустите назначение целей ещё раз или загрузите все реплеи кнопкой 🔧.`,
            'warn'
            );
        }

        return {
            idxByHeroes, idxByFull, defenderIdxByHeroes, defenderIdxByFull,
            enrichedCount, enrichedKeys, skippedNoData, cancelled,
            maxNew,
        };
    }

/* ================================================================
/  ОБОГАЩЕНИЕ КЭША РЕПЛЕЕВ
/ ================================================================ */
    async function doEnrichReplays(rids, isSilent = false) {
        if (!rids || rids.length === 0) return { ok: 0, fail: 0 };
        const cache = await getReplayStorageCache();
        let ok = 0, fail = 0;

        for (let i = 0; i < rids.length; i++) {
            const rid = rids[i];

            if (!isSilent) {
                setProgress((i / rids.length) * 100);
                if (i % 10 === 0) setPanelTitle(`🔧 Обогащение кэша: ${i}/${rids.length} (ok: ${ok}, fail: ${fail})`);
            }

            try {
                const fresh = await Caller.send({ name: 'battleGetReplay', args: { id: rid } });
                const data = cache[rid] || { attackers: [], defenders: [] };
                data.attackers = data.attackers || [];
                data.defenders = data.defenders || [];

                const att = fresh?.replay?.attackers;
                if (att) {
                    const list = Array.isArray(att) ? att : Object.values(att);
                    if (list.length > 0) {
                        if (!data.attackers[0]) data.attackers[0] = {};
                        data.attackers[0].units = extractUnitsInfo(list);
                        const sig = extractPackSignature(list);
                        if (sig) {
                            data.attackers[0].teamString = sig.heroes;
                            data.attackers[0].heroes = sig.heroes;
                            data.attackers[0].petId = sig.petId;
                            data.attackers[0].favorStr = sig.favorStr;
                            data.attackers[0].fullSig = sig.fullSig;
                            data.attackers[0].teamNames = getTeamNamesString(list);
                        }
                    }
                }

                const def = fresh?.replay?.defenders;
                if (Array.isArray(def) && def.length > 0) {
                    const firstDef = def[0];
                    if (!data.defenders[0]) data.defenders[0] = {};
                    data.defenders[0].units = extractUnitsInfo(firstDef);
                    const sig = extractPackSignature(firstDef);
                    if (sig) {
                        data.defenders[0].teamString = sig.heroes;
                        data.defenders[0].heroes = sig.heroes;
                        data.defenders[0].petId = sig.petId;
                        data.defenders[0].favorStr = sig.favorStr;
                        data.defenders[0].fullSig = sig.fullSig;
                        data.defenders[0].teamNames = getTeamNamesString(firstDef);
                        data.defenders[0].teamType = getTeamType(firstDef) || data.defenders[0].teamType;
                    }
                }

                cache[rid] = data;
                replayMemoryCache.set(rid, data);
                dirtyReplayIds.add(rid);
                replayStorageDirty = true;
                ok++;
            } catch (e) {
                fail++;
                logDebug(`enrich ${rid}: ${e.message}`);
            }

            await sleep(isSilent ? 1500 : 80);
        }

        if (!isSilent) setProgress(100);
        await flushReplayCache();
        return { ok, fail };
    }


    let isAutoEnriching = false;
    async function backgroundAutoEnrich() {
        if (isAutoEnriching) return;
        if (replayLoadRunning) {
            console.log('%c[HWH CW Cascade] Ручная загрузка активна — фоновое обогащение отложено', 'color: #888;');
            return;
        }
        isAutoEnriching = true;

        try {
            const history = await loadHistory();
            const vgReplayIds = new Set();
            for (const key in history) {
                if (key.startsWith('sm_')) continue;
                for (const b of (history[key] || [])) {
                    if (b.replayId) vgReplayIds.add(String(b.replayId));
                }
            }

            const cache = await getReplayStorageCache();
            const needEnrich = [];
            for (const rid in cache) {
                if (!vgReplayIds.has(String(rid))) continue;
                const d = cache[rid];
                const hasA = d?.attackers?.[0]?.units?.length > 0;
                const hasD = d?.defenders?.[0]?.units?.length > 0;
                if (!hasA || !hasD) needEnrich.push(rid);
            }

            if (needEnrich.length === 0) {
                isAutoEnriching = false;
                return;
            }

            const batch = needEnrich.slice(0, 30);
            console.log(`%c[HWH CW Cascade] Запуск фонового обогащения: ${batch.length} реплеев (только ВГ)...`, 'color: #888;');

            const res = await doEnrichReplays(batch, true);

            console.log(`%c[HWH CW Cascade] Фоновое обогащение завершено: ok=${res.ok}, fail=${res.fail}`, 'color: #7fff7f;');
        } catch (e) {
            console.warn('[HWH CW Cascade] Ошибка фонового обогащения:', e);
        } finally {
            isAutoEnriching = false;
        }
    }

    async function toggleReplayLoad() {
        if (replayLoadRunning) {
            replayLoadCancelFlag = true;
            logPanel('⏹️ Останавливаю загрузку реплеев...', 'warn');
            if (enrichBtn) {
                enrichBtn.textContent = '…';
                enrichBtn.disabled = true;
                enrichBtn.title = 'Останавливаю...';
            }
            return;
        }

        replayLoadRunning = true;
        replayLoadCancelFlag = false;
        if (enrichBtn) {
            enrichBtn.textContent = '⏹️';
            enrichBtn.title = 'Остановить загрузку реплеев';
            enrichBtn.disabled = true;
            setTimeout(() => { if (enrichBtn && replayLoadRunning) enrichBtn.disabled = false; }, 800);
        }
        createPanel();
        cancelAutoClose();
        setPanelTitle('📼 Загрузка реплеев (без лимита)...');
        setProgress(0);

        logPanel('📼 Запуск загрузки реплеев без лимита...', 'highlight');
        logPanel('💡 Повторное нажатие кнопки 🔧 остановит загрузку', 'info');

        try {
            await initStorage();
            const history = await loadHistory();

            const indexes = await buildPackIndex(history, Infinity, () => replayLoadCancelFlag);

            if (indexes.enrichedCount > 0) {
                await saveHistory(history, indexes.enrichedKeys);
                logPanel(`💾 История обогащена (+${indexes.enrichedCount})`, 'success');
            }
            await flushReplayCache();

            if (indexes.cancelled) {
                logPanel('⏹️ Загрузка остановлена пользователем', 'warn');
                setPanelTitle('⏹️ Остановлено');
            } else {
                logPanel(`✅ Загрузка реплеев завершена (загружено: ${indexes.enrichedCount})`, 'success');
                setPanelTitle('✅ Загрузка завершена');
            }
        } catch (e) {
            logPanel('❌ Ошибка загрузки реплеев: ' + e.message, 'error');
            setPanelTitle('❌ Ошибка');
        } finally {
            replayLoadRunning = false;
            replayLoadCancelFlag = false;
            if (enrichBtn) {
                enrichBtn.textContent = '🔧';
                enrichBtn.disabled = false;
                enrichBtn.title = 'Загрузить все реплеи (повторное нажатие — остановка)';
            }
            await logReplayCacheStats();
            setProgress(100);
            scheduleAutoClose();
        }
    }

/* ================================================================
/  ГИДРАТАЦИЯ СТАРЫХ НАЗНАЧЕНИЙ
/ ================================================================ */

    async function hydrateAssignments(records) {
        if (!Array.isArray(records) || records.length === 0) return records;

        const cache = await getReplayStorageCache();
        let updatedCount = 0;

        for (const r of records) {
            let needsUpdate = false;
            const cachedReplay = replayMemoryCache.get(r.replayId) || cache[r.replayId];

            if (!r.attackerUnits || !r.attackerUnits.length) {
                if (cachedReplay?.attackers?.[0]?.units?.length) {
                    r.attackerUnits = cachedReplay.attackers[0].units;
                    needsUpdate = true;
                }
            }

            if (!r.defenderUnits || !r.defenderUnits.length) {
                if (cachedReplay?.defenders?.[0]?.units?.length) {
                    r.defenderUnits = cachedReplay.defenders[0].units;
                    needsUpdate = true;
                }
            }

            if (needsUpdate && assignmentsApi.ready) {
                try {
                    await assignmentsApi.put(r);
                    updatedCount++;
                } catch (e) {
                    logDebug(`hydrateAssignments put: ${e.message}`);
                }
            }
        }

        if (updatedCount > 0) {
            logDebug(`💾 Hydrated ${updatedCount} assignments with units from cache`);
        }
        return records;
    }

/* ================================================================
/  КАСКАДНЫЙ ПОИСК СОВПАДЕНИЯ
/ ================================================================ */
    function findPackMatch(slot, indexes, excludeMemberId = null) {
        const { idxByHeroes, idxByFull, defenderIdxByHeroes, defenderIdxByFull } = indexes;
        const slotHeroes = slot.heroes || slot.teamString;
        const slotFullSig = slot.fullSig || `${slotHeroes}|${slot.petId || ''}|${slot.favorStr || ''}`;

        const minWins = CASCADE_MIN_WINS;

        const collect = (map, effectiveWinsFn) => {
            if (!map || map.size === 0) return [];
            const out = [];
            for (const [atkId, entry] of map) {
                if (excludeMemberId && atkId === excludeMemberId) continue;
                const wins = effectiveWinsFn ? effectiveWinsFn(entry) : entry.wins;
                if (wins < minWins) continue;
                out.push({ attackerId: atkId, entry, effectiveWins: wins });
            }
            return out.sort((a, b) => b.effectiveWins - a.effectiveWins);
        };

        let c = collect(defenderIdxByFull.get(`${slot.defenderId}|${slot.teamType}|${slotFullSig}`));
        if (c.length > 0) return { level: 'exact', candidates: c };

        c = collect(defenderIdxByHeroes.get(`${slot.defenderId}|${slot.teamType}|${slotHeroes}`));
        if (c.length > 0) return { level: 'sameDefenderMinor', candidates: c };

        if (!CASCADE_ALLOW_OTHER_DEFENDER) return null;

        const otherDefWins = (entry) => {
            let w = 0;
            for (const [defId, d] of entry.byDefender) if (defId !== slot.defenderId) w += d.wins;
            return w;
        };

        c = collect(idxByFull.get(`${slot.teamType}|${slotFullSig}`), otherDefWins);
        if (c.length > 0) return { level: 'otherDefenderExact', candidates: c };

        c = collect(idxByHeroes.get(`${slot.teamType}|${slotHeroes}`), otherDefWins);
        if (c.length > 0) return { level: 'otherDefenderMinor', candidates: c };

        return null;
    }

/* ================================================================
/  ОСНОВНАЯ ФУНКЦИЯ: АВТОНАЗНАЧЕНИЕ ЦЕЛЕЙ (ВГ)
/ ================================================================ */
    async function autoAssignGuildTargets() {
        if (replayLoadRunning) {
            await popup.confirm(
                '⚠️ Идёт ручная загрузка реплеев.<br><br>' +
                'Дождитесь окончания или остановите её кнопкой <b>🔧</b> на панели.',
                [{ msg: 'Ок', result: 0, color: 'green' }]
            );
            return;
        }
        createPanel();
        panelLog.innerHTML = '';
        cancelAutoClose();
        setPanelTitle(`🎯 Авто-цели ВГ v${GM_info.script.version}`);
        setProgress(0);
        if (altBtn) { altBtn.disabled = true; altBtn.onclick = null; }

        try {
            if (typeof Caller === 'undefined' || typeof Caller.send === 'undefined') {
                logPanel('⚠️ HeroWarsHelper (Caller) не найден', 'error');
                scheduleAutoClose(); return;
            }

            await initStorage();
            await assignmentsApi.init();

            window.__hwhCWGlobalClanMembers = {};
            try {
                const clanInfo = await Caller.send('clanGetInfo');
                if (clanInfo?.clan?.members) {
                    for (const id in clanInfo.clan.members) {
                        const m = clanInfo.clan.members[id];
                        if (m && typeof m === 'object') {
                            window.__hwhCWGlobalClanMembers[id] = m.name || m.nick || String(id);
                        } else if (typeof m === 'string') {
                            window.__hwhCWGlobalClanMembers[id] = m;
                        }
                    }
                    logDebug(`👥 clanGetInfo: получено ${Object.keys(window.__hwhCWGlobalClanMembers).length} ников`);
                }
            } catch (e) {
                logDebug('clanGetInfo (для ников): ' + e.message);
            }

            logPanel('📡 Определение активного режима...', 'info');
            setProgress(3);
            const activeModes = await detectActiveWarModes();
            if (activeModes.length === 0) {
                logPanel('⚠️ ВГ не активна.', 'warn');
                logPanel('🔍 Обогащение истории (дозагрузка недостающих реплеев)...', 'info');
                setPanelTitle('🔍 Обогащение истории...');
                setProgress(50);
                let enrichIndexes = null;
                try {
                    const mergedHistory = await loadHistory();
                    enrichIndexes = await buildPackIndex(mergedHistory);
                    if (enrichIndexes.enrichedCount > 0) {
                        await saveHistory(mergedHistory, enrichIndexes.enrichedKeys);
                        logPanel(`💾 История обогащена (+${enrichIndexes.enrichedCount})`, 'success');
                    } else {
                        logPanel('✅ История уже полная — обогащать нечего', 'info');
                    }
                    await flushReplayCache();
                } catch (e) {
                    logPanel('⚠️ Ошибка обогащения: ' + e.message, 'warn');
                }
                setProgress(100);
                setPanelTitle('✅ Готово');
                await checkStorageSize();

                const stats = await logReplayCacheStats();
                if (enrichIndexes && enrichIndexes.skippedNoData > 0) {
                    logPanel(
                        `⚠️ Сработало ограничение на единовременную загрузку реплеев: ${enrichIndexes.maxNew}. ` +
                        `Не все реплеи догрузились. Догрузите кнопкой 🔧.`,
                        'warn'
                    );
                }
                if (stats.partial > 0) {
                    logPanel(
                        `📼 Реплеи неполные: ${stats.partial} из ${stats.total} без полного состава. ` +
                        `Догрузите кнопкой 🔧 — тогда матчи будут точнее.`,
                        'warn'
                    );
                }

                scheduleAutoClose();
                return;
            }

            logPanel('📜 Обновление базы истории ВГ...', 'info');
            setProgress(6);
            let mergedHistory = await loadHistory();

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
                            if (dayHistory?.attack) {
                                newDataToMerge[`${hist.season}_${hist.day}`] = dayHistory.attack;
                            }
                            loadedDays++;
                            setProgress(6 + (loadedDays / historyList.history.length) * 12);
                            await sleep(100);
                        } catch (e) {
                            logPanel(`Не удалось загрузить день ВГ ${hist.season}_${hist.day}`, 'warn');
                        }
                    }
                    mergedHistory = await mergeAndSaveHistory(newDataToMerge);
                }
            } catch (e) {
                logPanel('⚠️ Не удалось обновить историю ВГ: ' + e.message, 'warn');
            }

            const overallAssigned = [];
            let progressBase = 30;
            let lastIndexes = null;

            for (const modeInfo of activeModes) {
                setProgress(progressBase);
                logPanel(`━━━ Режим: ${WAR_MODE_LABEL} ━━━`, 'highlight');

                const res = await autoAssignForMode(modeInfo, mergedHistory);
                overallAssigned.push(...res.assigned);
                if (res.indexes) lastIndexes = res.indexes;

                progressBase += 60;
            }

            setProgress(100);
            logPanel('━'.repeat(30), 'info');
            logPanel(
                `🏁 Итого: ${overallAssigned.length} ${plural(overallAssigned.length, ['назначение', 'назначения', 'назначений'])}`,
                'highlight'
            );
            setPanelTitle(`🎯 Готово: ${overallAssigned.length} ${plural(overallAssigned.length, ['назначение', 'назначения', 'назначений'])}`);
            await checkStorageSize();

            const stats = await logReplayCacheStats();

            if (lastIndexes && lastIndexes.skippedNoData > 0) {
                logPanel(
                    `⚠️ Сработало ограничение на единовременную загрузку реплеев: ${lastIndexes.maxNew}. ` +
                    `Не все реплеи догрузились, остались необновлённые записи. ` +
                    `Запустите назначение целей ещё раз или загрузите все реплеи кнопкой 🔧.`,
                    'warn'
                );
            }

            if (stats.partial > 0) {
                logPanel(
                    `📼 Реплеи неполные: ${stats.partial} из ${stats.total} без полного состава. ` +
                    `Догрузите кнопкой 🔧 — тогда матчи будут точнее.`,
                    'warn'
                );
            }
            const cw = activeModes[0];
            window.__hwhCWLastInfo = {
                mode: WAR_MODE_CLAN,
                season: String(cw.season),
                day: parseInt(cw.day, 10),
                league: cw.league,
            };
            localStorage.setItem('HWH_CW_LastInfo', JSON.stringify(window.__hwhCWLastInfo));
            const noUnits = overallAssigned.filter(a =>
                                                   !a.attackerUnits?.length || !a.defenderUnits?.length
                                                  );
            if (noUnits.length > 0) {
                logPanel(
                    `⚠️ ${noUnits.length} ${plural(noUnits.length, ['назначение', 'назначения', 'назначений'])} без полного состава пачек`,
                    'warn'
                );
                logPanel('💡 Запустите загрузку реплеев вручную: кнопка 🔧 на панели', 'warn');
                await popup.confirm(
                `⚠️ В ${noUnits.length} ${plural(noUnits.length, ['назначении', 'назначениях', 'назначениях'])} нет полного состава пачек.<br><br>` +
                `Запустите загрузку реплеев вручную — кнопка <b>🔧</b> на панели.<br>` +
                `Повторное нажатие кнопки остановит загрузку.`,
                    [{ msg: 'Ок', result: 0, color: 'green' }]
                );
            }
        } catch (error) {
            logPanel(`💥 Критическая ошибка: ${error.message}`, 'error');
            setPanelTitle('🎯 Ошибка');
        }
        scheduleAutoClose();
    }

/* ================================================================
/  НАЗНАЧЕНИЕ ЦЕЛЕЙ ДЛЯ ВГ
/ ================================================================ */
    async function autoAssignForMode(modeInfo, mergedHistory) {
        const {
            season, day, enemySlots, clanTries, league,
            ourSlots, ourClanMembers, enemyClanMembers,
        } = modeInfo;

        const modeLabel = WAR_MODE_LABEL;
        const logPrefix = '🏰';

        const memberNames = {};
        if (window.__hwhCWGlobalClanMembers) {
            for (const id in window.__hwhCWGlobalClanMembers) {
                memberNames[id] = window.__hwhCWGlobalClanMembers[id];
            }
        }
        if (ourClanMembers) for (const m of Object.values(ourClanMembers)) {
            if (m.id) memberNames[m.id] = m.name || memberNames[m.id] || String(m.id);
        }
        if (enemyClanMembers) for (const m of Object.values(enemyClanMembers)) {
            if (m.id) memberNames[m.id] = m.name || memberNames[m.id] || String(m.id);
        }
        if (ourSlots) for (const s of Object.values(ourSlots)) {
            if (s.user?.id) memberNames[s.user.id] = s.user.name || memberNames[s.user.id] || String(s.user.id);
        }
        for (const s of Object.values(enemySlots)) {
            if (s.user?.id) memberNames[s.user.id] = s.user.name || memberNames[s.user.id] || String(s.user.id);
        }

        logPanel(
            `${logPrefix} ${modeLabel}: сезон ${season}, день ${day}` +
            (league != null ? `, лига: ${league == 1 ? 'Золотая' : 'Серебряная'}` : ''),
            'info'
        );

        const enemyUserIds = new Set();
        for (const slot of Object.values(enemySlots)) {
            if (slot.user?.id) enemyUserIds.add(String(slot.user.id));
        }

        const alreadyAttackedToday = new Set();
        const attackedTodayCount = new Map();
        try {
            const t = await Caller.send({
                name: 'clanWarGetDayHistory',
                args: { season: parseInt(season), day: parseInt(day) }
            });
            const todayBattles = t?.attack || [];
            for (const battle of todayBattles) {
                const defId = String(battle.defenderId);
                const atkId = String(battle.attackerId || '0');
                const slotId = battle.slotId;

                if (atkId && atkId !== '0' && atkId !== 'null' && atkId !== 'undefined') {
                    attackedTodayCount.set(atkId, (attackedTodayCount.get(atkId) || 0) + 1);
                }
                if (enemyUserIds.has(defId)) {
                    alreadyAttackedToday.add(slotId ? `${defId}_${slotId}` : defId);
                    const defName = memberNames[defId] || defId;
                    const atkName = memberNames[atkId] || atkId;
                    const slotInfo = slotId ? ` (слот ${slotId})` : '';
                    logPanel(`🛡️ ${defName}${slotInfo}: атакован сегодня (${atkName})`, 'warn');
                }
            }
        } catch (e) { logDebug('alreadyAttackedToday: ' + e.message); }
        const totalAttacksToday = [...attackedTodayCount.values()].reduce((a, b) => a + b, 0);
        logPanel(
            `🛡️ ${modeLabel}: атаковано сегодня ${alreadyAttackedToday.size} защитн., атак всего: ${totalAttacksToday}, ` +
            `уникальных атакующих: ${attackedTodayCount.size}`,
            'info'
        );

        const preAssignedTries = new Map();
        for (const [slotIdStr, slotData] of Object.entries(enemySlots)) {
            const slotId = parseInt(slotIdStr);
            if (!slotData.user) continue;
            if (slotData.status !== 'ready') continue;
            const defId = String(slotData.user.id);
            if (alreadyAttackedToday.has(`${defId}_${slotId}`) || alreadyAttackedToday.has(defId)) continue;

            const raw = String(slotData.targetMarkingUserId || '0');
            const markerId = (raw !== '0' && raw !== 'null' && raw !== 'undefined') ? raw : '0';
            const attackerId = String(slotData.attackerId || '0');

            if (markerId !== '0') {
                preAssignedTries.set(markerId, (preAssignedTries.get(markerId) || 0) + 1);
            }
            if (attackerId !== '0' && attackerId !== 'null' && attackerId !== 'undefined' && attackerId !== markerId) {
                preAssignedTries.set(attackerId, (preAssignedTries.get(attackerId) || 0) + 1);
            }
        }

        const guildMembers = [];
        let totalTries = 0;

        for (const userId of Object.keys(clanTries)) {
            if (userId === 'clan') continue;

            const info = parseClanTries(clanTries[userId]);
            const marked = preAssignedTries.get(userId) || 0;
            const alreadyAttacked = attackedTodayCount.get(userId) || 0;

            const total = Math.min(2, info.heroes + info.titans);
            const available = Math.max(0, total - marked);

            guildMembers.push({
                id: userId, total, available,
                alreadyUsed: marked,
                alreadyAttacked,
                _raw: clanTries[userId],
            });

            if (available > 0) totalTries += available;
        }
        guildMembers.sort((a, b) => b.available - a.available);

        if (guildMembers.filter(m => m.available > 0).length === 0) {
            logPanel(`⚠️ ${modeLabel}: нет попыток для атаки.`, 'warn');
            for (const m of guildMembers) {
                if (m.alreadyUsed === 0 && m.total === 0) continue;
                const nm = memberNames[m.id] || m.id;
                const totalAll = m.total + m.alreadyUsed;
                if (m.alreadyUsed > m.total) {
                    logPanel(
                        `👤 ${nm}: ⚠️ ПЕРЕГРУЗ — назначено ${m.alreadyUsed} при остатке попыток ${m.total}. ` +
                        `Снимите лишние метки (кнопка ❌ Снять ВГ).`,
                        'error'
                    );
                } else {
                    logPanel(
                        `👤 ${nm}: свободно 0/${totalAll} ` +
                        `(назначено: ${m.alreadyUsed}, атаковано сегодня: ${m.alreadyAttacked})`,
                        'warn'
                    );
                }
            }
            return { assigned: [], indexes: null };
        }
        const activeMembers = guildMembers.filter(m => m.available > 0).length;
        logPanel(
            `✅ ${modeLabel}: ${activeMembers} ${plural(activeMembers, ['игрок', 'игрока', 'игроков'])}, всего ${totalTries} ${plural(totalTries, ['попытка', 'попытки', 'попыток'])}`,
            'success'
        );

        for (const m of guildMembers) {
            const nm = memberNames[m.id] || m.id;
            const totalAll = m.total + m.alreadyUsed;
            if (m.alreadyUsed > m.total) {
                logPanel(
                    `👤 ${nm}: ⚠️ ПЕРЕГРУЗ — назначено ${m.alreadyUsed} при остатке попыток ${m.total}. ` +
                    `Снимите лишние метки (кнопка ❌ Снять ВГ).`,
                    'error'
                );
            } else if (m.available > 0) {
                logPanel(
                    `👤 ${nm}: свободно ${m.available}/${totalAll} ` +
                    `(назначено: ${m.alreadyUsed}, атаковано сегодня: ${m.alreadyAttacked})`,
                    'info'
                );
            } else if (m.total > 0 || m.alreadyUsed > 0) {
                logPanel(
                    `👤 ${nm}: свободно 0/${totalAll} ` +
                    `(назначено: ${m.alreadyUsed}, атаковано сегодня: ${m.alreadyAttacked})`,
                    'warn'
                );
            }
        }

        const freeSlots = new Map();
        const skippedSlots = [];

        for (const [slotId, slotData] of Object.entries(enemySlots)) {
            const defenderId = slotData.user?.id ? String(slotData.user.id) : null;
            if (!defenderId) continue;
            const defenderName = slotData.user?.name || 'N/A';

            const isMarkFree = !slotData.targetMarkingUserId || String(slotData.targetMarkingUserId) === '0';
            const isAttackerFree = !slotData.attackerId || String(slotData.attackerId) === '0';
            const isReady = slotData.status === 'ready';
            const attackKey = `${defenderId}_${slotId}`;
            const isNotAttackedToday = !alreadyAttackedToday.has(attackKey) && !alreadyAttackedToday.has(defenderId);

            if (!(isMarkFree && isAttackerFree && isReady && isNotAttackedToday)) {
                const reasons = [];
                if (!isMarkFree) reasons.push(`targetMark=${slotData.targetMarkingUserId}`);
                if (!isAttackerFree) reasons.push(`attacker=${slotData.attackerId}`);
                if (!isReady) reasons.push(`status=${slotData.status}`);
                if (!isNotAttackedToday) reasons.push(`атакован сегодня`);
                skippedSlots.push({ slotId, defenderId, defenderName, reasons });
                continue;
            }

            const teamUnits = extractSlotTeam(slotData);
            if (!teamUnits || teamUnits.length === 0) {
                skippedSlots.push({ slotId, defenderId, defenderName, reasons: ['нет team'] });
                continue;
            }
            const slotSig = extractPackSignature(teamUnits);
            const teamType = getTeamType(teamUnits);
            if (!slotSig || !teamType) {
                skippedSlots.push({ slotId, defenderId, defenderName, reasons: ['не извлечён состав'] });
                continue;
            }

            const slotType = getSlotType(teamUnits);

            freeSlots.set(parseInt(slotId), {
                slotId: parseInt(slotId),
                defenderId,
                defenderName: slotData.user?.name || 'N/A',
                slotLocation: getSlotLocation(slotId, league),
                teamType,
                teamString: slotSig.heroes,
                heroes: slotSig.heroes,
                petId: slotSig.petId,
                favorStr: slotSig.favorStr,
                fullSig: slotSig.fullSig,
                teamNames: getTeamNamesString(teamUnits),
                assignedAttackerId: null,
                slotType,
            });
        }

        logPanel(`🎯 ${modeLabel}: свободных слотов ${freeSlots.size} (пропущено ${skippedSlots.length})`, 'info');
        if (skippedSlots.length > 0) {
            logPanel('⏭️ Пропущенные слоты:', 'warn');
            for (const s of skippedSlots) {
                logPanel(`  • ${getSlotLocation(s.slotId, league)} ${s.defenderName}: ${s.reasons.join(', ')}`, 'warn');
            }
        }

        if (freeSlots.size === 0) {
            logPanel(`⚠️ ${modeLabel}: свободных слотов нет.`, 'warn');
            return { assigned: [], indexes: null };
        }

        const heroSlots = [...freeSlots.values()].filter(s => s.slotType === 'hero').length;
        const titanSlots = [...freeSlots.values()].filter(s => s.slotType === 'titan').length;
        logPanel(
            `🎯 ${modeLabel}: свободных слотов ${freeSlots.size} ` +
            `(герой: ${heroSlots}, титан: ${titanSlots})`,
            'info'
        );

        const indexes = await buildPackIndex(mergedHistory);
        await flushReplayCache();

        const historyKeys = Object.keys(mergedHistory).sort(compareHistoryKeys);
        for (const m of guildMembers) {
            if (m.available <= 0) continue;
            const defendersWithWins = new Set();
            for (const key of historyKeys) {
                if (key.startsWith('sm_')) continue;
                const battles = mergedHistory[key] || [];
                for (const b of battles) {
                    if (b.attackerId === m.id && isFullWin(b) && !isEmptyBattle(b)) {
                        defendersWithWins.add(b.defenderId);
                    }
                }
            }
            const nm = memberNames[m.id] || m.id;
            if (defendersWithWins.size > 0) {
                const namesList = [...defendersWithWins].map(id => memberNames[id] || id).join(', ');
                logPanel(`📚 ${nm} (${m.available} попыт.): победы в базе против: ${namesList}`, 'info');
            } else {
                logPanel(`📚 ${nm} (${m.available} попыт.): побед в базе НЕТ`, 'warn');
            }
        }

        const assigned = [];
        const assignedCount = new Map();
        const slotAssignments = [];
        const enrichedKeys = new Set();
        const levelOrder = ['exact', 'sameDefenderMinor', 'otherDefenderExact', 'otherDefenderMinor'];
        const levelLabel = {
            exact: '✅',
            sameDefenderMinor: '⚠️ ~пит',
            otherDefenderExact: '🔄 ≠ID',
            otherDefenderMinor: '🔄⚠️ ≠ID~пит',
        };
        const levelColor = {
            exact: 'success',
            sameDefenderMinor: 'warn',
            otherDefenderExact: 'info',
            otherDefenderMinor: 'warn',
        };

        const attackLimitSet = new Set();
        const attackLimitLogged = new Set();

        for (let li = 0; li < levelOrder.length; li++) {
            const level = levelOrder[li];
            setPanelTitle(`🎯 ${modeLabel} · Фаза ${li + 1}/4: ${levelLabel[level]}`);

            const levelMatches = [];
            for (const slot of freeSlots.values()) {
                const match = findPackMatch(slot, indexes, null);
                if (match && match.level === level) levelMatches.push({ slot, match });
            }
            if (levelMatches.length === 0) continue;

            for (const { slot, match } of levelMatches) {
                if (!freeSlots.has(slot.slotId)) continue;

                const triedUsers = new Set();
                let assignedOk = false;
                let lastError = null;

                while (!assignedOk) {
                    const eligible = [];
                    for (const c of match.candidates) {
                        if (triedUsers.has(c.attackerId)) continue;
                        if (attackLimitSet.has(c.attackerId)) continue;
                        const member = guildMembers.find(m => m.id === c.attackerId);
                        if (!member) continue;
                        if (member.available <= 0) continue;
                        eligible.push({ ...c, member, availForSlot: member.available });
                    }
                    if (eligible.length === 0) break;

                    eligible.sort((a, b) => {
                        if (b.effectiveWins !== a.effectiveWins) return b.effectiveWins - a.effectiveWins;
                        return b.availForSlot - a.availForSlot;
                    });

                    const best = eligible[0];
                    triedUsers.add(best.attackerId);
                    const memberName = memberNames[best.member.id] || best.member.id;

                    const res = await setTargetMark(best.member.id, slot.slotId);

                    if (res.ok) {
                        assignedOk = true;
                        best.member.available = Math.max(0, best.member.available - 1);
                        assignedCount.set(best.member.id, (assignedCount.get(best.member.id) || 0) + 1);
                        slot.assignedAttackerId = best.member.id;

                        let attackerUnits = best.entry.attackerUnits || [];
                        let defenderUnits = best.entry.defenderUnits || [];

                        if ((!attackerUnits.length || !defenderUnits.length) && best.entry.lastReplayId) {
                            const fresh = await forceGetReplayUnits(best.entry.lastReplayId);
                            if (fresh) {
                                if (fresh.attackerUnits.length) attackerUnits = fresh.attackerUnits;
                                if (fresh.defenderUnits.length) defenderUnits = fresh.defenderUnits;
                                const cached = replayMemoryCache.get(best.entry.lastReplayId);
                                if (cached) {
                                    if (fresh.attackerUnits.length && cached.attackers?.[0]) {
                                        cached.attackers[0].units = fresh.attackerUnits;
                                    }
                                    if (fresh.defenderUnits.length && cached.defenders?.[0]) {
                                        cached.defenders[0].units = fresh.defenderUnits;
                                    }
                                    dirtyReplayIds.add(best.entry.lastReplayId);
                                    replayStorageDirty = true;
                                }
                            }
                        }

                        if (attackerUnits.length) best.entry.attackerUnits = attackerUnits;
                        if (defenderUnits.length) best.entry.defenderUnits = defenderUnits;

                        if ((best.entry.winProbability === null || best.entry.winProbability === undefined) && best.entry.lastReplayId) {
                            const replayId = best.entry.lastReplayId;
                            logPanel(`🎲 Дорасчёт шанса победы для ${replayId}...`, 'info');
                            try {
                                const replayResp = await Caller.send({ name: 'battleGetReplay', args: { id: replayId } });
                                if (replayResp?.replay) {
                                    const prob = await calcProbability(replayResp.replay, SIM_COUNT_PROBABILITY, SIM_YIELD_PROBABILITY_MS);
                                    if (typeof prob === 'number') {
                                        best.entry.winProbability = prob;
                                        logPanel(`📊 Шанс победы ${replayId}: ${Math.round(prob * 100)}%`, 'info');
                                        const found = findBattleInHistory(mergedHistory, replayId);
                                        if (found && typeof found.battle.winProbability !== 'number') {
                                            found.battle.winProbability = prob;
                                            enrichedKeys.add(found.key.trim());
                                        }
                                    } else {
                                        logPanel(`⚠️ Не удалось рассчитать шанс ${replayId}`, 'warn');
                                    }
                                }
                            } catch (e) {
                                console.warn('[HWH CW Cascade] Ошибка дорасчёта вероятности:', e);
                            }
                        }

                        const record = {
                            mode: WAR_MODE_CLAN, season, day: parseInt(day), league,
                            memberId: best.member.id,
                            memberName,
                            slotId: slot.slotId,
                            slotLocation: slot.slotLocation,
                            defenderId: slot.defenderId,
                            defenderName: slot.defenderName,
                            teamType: slot.teamType,
                            teamString: slot.teamString,
                            heroes: slot.heroes,
                            petId: slot.petId,
                            favorStr: slot.favorStr,
                            fullSig: slot.fullSig,
                            matchLevel: match.level,
                            replayId: best.entry.lastReplayId,
                            winProbability: (typeof best.entry.winProbability === 'number') ? best.entry.winProbability : null,
                            attackerNames: best.entry.attackerNames,
                            defenderNames: best.entry.defenderNames,
                            attackerUnits,
                            defenderUnits,
                            slotType: slot.slotType,
                        };
                        assigned.push(record);
                        slotAssignments.push(record);

                        const probText = (typeof best.entry.winProbability === 'number')
                            ? `, шанс: ${Math.round(best.entry.winProbability * 100)}%`
                            : '';
                        const replayText = best.entry.lastReplayId
                            ? ` | 🔗 https://www.hero-wars.com/?replay_id=${best.entry.lastReplayId}`
                            : '';

                        logPanel(
                            `${levelLabel[match.level]} ${memberName} → ${slot.slotLocation}: ` +
                            `${slot.defenderName} (${best.effectiveWins} ${plural(best.effectiveWins, ['победа', 'победы', 'побед'])}${probText}, ` +
                            `остаток: ${best.availForSlot - 1})${replayText}`,
                            levelColor[match.level]
                        );
                        if (attackerUnits.length) logTeamDetails('     ⚔️ ', attackerUnits);
                        if (defenderUnits.length) logTeamDetails('     🛡️ ', defenderUnits);
                        if (!attackerUnits.length || !defenderUnits.length) {
                            logPanel(
                                `     ⚠️ состав не загружен (replayId=${best.entry.lastReplayId || '?'}) — посмотрите в игре`,
                                'warn'
                            );
                        }

                        freeSlots.delete(slot.slotId);
                    } else {
                        lastError = res.error;
                        if (res.error === 'attackLimit') {
                            attackLimitSet.add(best.attackerId);
                            if (!attackLimitLogged.has(best.attackerId)) {
                                attackLimitLogged.add(best.attackerId);
                                logPanel(
                                    `⚠️ ${modeLabel}: у ${memberName} (${best.attackerId}) attackLimit — ` +
                                    `clanTries=${JSON.stringify(best.member._raw)}. Исключаю из прогона.`,
                                    'warn'
                                );
                            }
                            continue;
                        } else {
                            logPanel(
                                `❌ ${modeLabel}: ошибка назначения #${slot.slotId} ` +
                                `(${memberName}, user=${best.attackerId}): ${JSON.stringify(res.error)}`,
                                'error'
                            );
                            break;
                        }
                    }
                }

                if (!assignedOk && !lastError) {
                    const stats = {
                        total: match.candidates.length,
                        notInClan: 0, noTries: 0, attackLimit: 0, tried: 0,
                    };
                    for (const c of match.candidates) {
                        if (triedUsers.has(c.attackerId)) { stats.tried++; continue; }
                        if (attackLimitSet.has(c.attackerId)) { stats.attackLimit++; continue; }
                        const m = guildMembers.find(mm => mm.id === c.attackerId);
                        if (!m) { stats.notInClan++; continue; }
                        if (m.available <= 0) { stats.noTries++; continue; }
                    }
                    logPanel(
                        `⏭️ ${modeLabel}: слот #${slot.slotId} пропущен — ` +
                        `кандидатов: ${stats.total}, ` +
                        `не в клане: ${stats.notInClan}, ` +
                        `нет попыток: ${stats.noTries}` +
                        (stats.attackLimit ? `, attackLimit: ${stats.attackLimit}` : '') +
                        (stats.tried ? `, уже пробовали: ${stats.tried}` : ''),
                        'info'
                    );
                }

                await sleep(120);
            }
        }

        const allEnrichedKeys = new Set([
            ...(indexes?.enrichedKeys || []),
            ...enrichedKeys,
        ]);
        if (allEnrichedKeys.size > 0) {
            await saveHistory(mergedHistory, allEnrichedKeys);
            logPanel(`💾 История обновлена (составы + шансы, ${allEnrichedKeys.size} дн.)`, 'info');
        }

        for (const rec of slotAssignments) {
            try { await assignmentsApi.put(rec); }
            catch (e) { logPanel(`⚠️ IndexedDB: ${e.message}`, 'warn'); }
        }

        if (freeSlots.size > 0 && altBtn) {
            altBtn.disabled = false;
            altBtn.title = `Альтернативы для оставшихся слотов ${modeLabel}`;
            altBtn.onclick = async (e) => {
                e.stopPropagation(); cancelAutoClose();
                await findAndAssignAlternatives(
                    [...freeSlots.values()], assigned, guildMembers, assignedCount,
                    alreadyAttackedToday, memberNames, mergedHistory,
                    { season, day, league }
                );
            };
            logPanel(`💡 ${modeLabel}: осталось ${freeSlots.size} ${plural(freeSlots.size, ['слот', 'слота', 'слотов'])} — нажмите ⚔️`, 'highlight');
        }

        const byLevel = {};
        for (const a of assigned) byLevel[a.matchLevel] = (byLevel[a.matchLevel] || 0) + 1;
        logPanel(
            `${logPrefix} ${modeLabel} итог: ${assigned.length} ${plural(assigned.length, ['назначение', 'назначения', 'назначений'])}. ` +
            levelOrder.filter(l => byLevel[l]).map(l => `${levelLabel[l]}×${byLevel[l]}`).join(', '),
            'highlight'
        );

        const assignedByMember = new Map();
        for (const a of assigned) assignedByMember.set(a.memberId, (assignedByMember.get(a.memberId) || 0) + 1);
        const skippedMembers = [];
        for (const m of guildMembers) {
            const got = assignedByMember.get(m.id) || 0;
            if (got === 0 && m.available === 0) continue;
            const originalAvailable = m.available + got;
            if (got < originalAvailable) {
                skippedMembers.push(`${memberNames[m.id] || m.id}: назначено ${got} из ${originalAvailable}`);
            }
        }
        if (skippedMembers.length > 0) {
            logPanel('⚠️ Пропущено (не все попытки использованы):', 'warn');
            for (const s of skippedMembers) logPanel(`  • ${s}`, 'warn');
        }

        return { assigned, indexes };
    }

/* ================================================================
/  АЛЬТЕРНАТИВЫ
/ ================================================================ */
    async function findAlternatives(freeSlotsArr, indexes, guildMembers, assignedCount, alreadyAttackedToday, memberNames) {
        const alts = new Map();
        for (const slot of freeSlotsArr) {
            const match = findPackMatch(slot, indexes, null);
            if (!match) continue;

            const eligible = [];
            for (const c of match.candidates) {
                const member = guildMembers.find(m => m.id === c.attackerId);
                if (!member) continue;
                const left = member.available;
                if (left <= 0) continue;
                if (slot.assignedAttackerId === c.attackerId) continue;

                eligible.push({
                    attackerId: c.attackerId,
                    attackerName: memberNames[c.attackerId] || c.attackerId,
                    winsCount: c.effectiveWins,
                    triesLeft: left,
                    attackerNames: c.entry.attackerNames,
                    defenderNames: c.entry.defenderNames,
                    attackerUnits: c.entry.attackerUnits,
                    defenderUnits: c.entry.defenderUnits,
                    replayId: c.entry.lastReplayId,
                    winProbability: (typeof c.entry.winProbability === 'number') ? c.entry.winProbability : null,
                });
            }
            if (eligible.length > 0) {
                alts.set(slot.slotId, { slotInfo: slot, level: match.level, topList: eligible.slice(0, 5) });
            }
        }
        return alts;
    }

    function logAlternatives(alternatives) {
        if (alternatives.size === 0) { logPanel('⚠️ Альтернатив не найдено', 'warn'); return; }
        const labels = {
            exact: '✅',
            sameDefenderMinor: '⚠️ ~пит',
            otherDefenderExact: '🔄 ≠ID',
            otherDefenderMinor: '🔄⚠️ ≠ID~пит',
        };
        logPanel('🔄 Альтернативы для свободных слотов:', 'highlight');
        for (const [, d] of alternatives) {
            logPanel(`• ${d.slotInfo.slotLocation}: ${d.slotInfo.defenderName} [${labels[d.level]}]`, 'warn');
            for (const c of d.topList) {
                logPanel(`  • ${c.attackerName} (${c.winsCount} ${plural(c.winsCount, ['победа', 'победы', 'побед'])}, ${c.triesLeft} ${plural(c.triesLeft, ['попытка', 'попытки', 'попыток'])})`, 'warn');
            }
        }
    }

    async function assignAlternatives(alternatives, guildMembers, assignedCount, modeInfo, mergedHistory) {
        cancelAutoClose();
        if (alternatives.size === 0) return;
        const { season, day, league } = modeInfo;
        let count = 0;
        const altEnrichedKeys = new Set();
        setPanelTitle('⚔️ Альт-назначения...');
        setProgress(0);
        let idx = 0;

        for (const [slotId, d] of alternatives) {
            setProgress((idx++ / alternatives.size) * 100);

            for (const alt of d.topList) {
                const member = guildMembers.find(m => m.id === alt.attackerId);
                if (!member) continue;
                if (member.available <= 0) continue;

                const res = await setTargetMark(alt.attackerId, slotId);
                if (res.ok) {
                    count++;
                    member.available = Math.max(0, member.available - 1);
                    assignedCount.set(alt.attackerId, (assignedCount.get(alt.attackerId) || 0) + 1);

                    let attackerUnits = alt.attackerUnits || [];
                    let defenderUnits = alt.defenderUnits || [];
                    if ((!attackerUnits.length || !defenderUnits.length) && alt.replayId) {
                        const fresh = await forceGetReplayUnits(alt.replayId);
                        if (fresh) {
                            if (fresh.attackerUnits.length) attackerUnits = fresh.attackerUnits;
                            if (fresh.defenderUnits.length) defenderUnits = fresh.defenderUnits;
                        }
                    }

                    let winProbability = (typeof alt.winProbability === 'number') ? alt.winProbability : null;
                    if (winProbability === null && alt.replayId) {
                        logPanel(`🎲 Дорасчёт шанса для альтернативы ${alt.replayId}...`, 'info');
                        try {
                            const replayResp = await Caller.send({ name: 'battleGetReplay', args: { id: alt.replayId } });
                            if (replayResp?.replay) {
                                const prob = await calcProbability(replayResp.replay, SIM_COUNT_PROBABILITY, SIM_YIELD_PROBABILITY_MS);
                                if (typeof prob === 'number') {
                                    winProbability = prob;
                                    logPanel(`📊 Шанс ${alt.replayId}: ${Math.round(prob * 100)}%`, 'info');
                                    if (mergedHistory) {
                                        const found = findBattleInHistory(mergedHistory, alt.replayId);
                                        if (found && typeof found.battle.winProbability !== 'number') {
                                            found.battle.winProbability = prob;
                                            altEnrichedKeys.add(found.key.trim());
                                        }
                                    }
                                } else {
                                    logPanel(`⚠️ Не удалось рассчитать шанс ${alt.replayId}`, 'warn');
                                }
                            }
                        } catch (e) {
                            console.warn('[HWH CW Cascade] Ошибка дорасчёта (альт):', e);
                        }
                    }

                    const probText = (typeof winProbability === 'number')
                        ? `, шанс: ${Math.round(winProbability * 100)}%`
                        : '';
                    const replayText = alt.replayId
                        ? ` | 🔗 https://www.hero-wars.com/?replay_id=${alt.replayId}`
                        : '';

                    logPanel(
                        `✅ Альт: ${alt.attackerName} → ${d.slotInfo.slotLocation}: ${d.slotInfo.defenderName} [${d.level}]${probText}${replayText}`,
                        'success'
                    );
                    if (attackerUnits.length) logTeamDetails('     ⚔️ ', attackerUnits);
                    if (defenderUnits.length) logTeamDetails('     🛡️ ', defenderUnits);
                    if (!attackerUnits.length || !defenderUnits.length) {
                        logPanel(`     ⚠️ состав не загружен (replayId=${alt.replayId || '?'})`, 'warn');
                    }

                    try {
                        await assignmentsApi.put({
                            mode: WAR_MODE_CLAN, season, day: parseInt(day), league,
                            timestamp: Date.now(),
                            slotId,
                            slotLocation: d.slotInfo.slotLocation,
                            defenderId: d.slotInfo.defenderId,
                            defenderName: d.slotInfo.defenderName,
                            memberId: alt.attackerId,
                            memberName: alt.attackerName,
                            teamType: d.slotInfo.teamType,
                            teamString: d.slotInfo.teamString,
                            heroes: d.slotInfo.heroes,
                            petId: d.slotInfo.petId,
                            favorStr: d.slotInfo.favorStr,
                            fullSig: d.slotInfo.fullSig,
                            matchLevel: d.level,
                            replayId: alt.replayId,
                            winProbability: (typeof winProbability === 'number') ? winProbability : null,
                            attackerUnits,
                            defenderUnits,
                            slotType: d.slotInfo.slotType,
                        });
                    } catch (e) {}
                    break;
                }
            }
            await sleep(150);
        }

        if (altEnrichedKeys.size > 0 && mergedHistory) {
            await saveHistory(mergedHistory, altEnrichedKeys);
            logPanel(`💾 Сохранены вероятности альтернатив: ${altEnrichedKeys.size} дн.`, 'info');
        }

        setProgress(100);
        logPanel(`🔄 Альтернативно назначено: ${count} ${plural(count, ['цель', 'цели', 'целей'])}`, 'highlight');
        if (altBtn) altBtn.disabled = true;
        scheduleAutoClose();
    }

    async function findAndAssignAlternatives(freeSlotsArr, assigned, guildMembers, assignedCount,
                                              alreadyAttackedToday, memberNames, mergedHistory, modeInfo) {
        if (replayLoadRunning) {
            await popup.confirm(
            '⚠️ Идёт ручная загрузка реплеев.<br><br>' +
            'Дождитесь окончания или остановите её кнопкой <b>🔧</b> на панели.',
                [{ msg: 'Ок', result: 0, color: 'green' }]
            );
            return;
        }
        try {
            setPanelTitle('🔍 Поиск альтернатив...');
            setProgress(0);
            if (altBtn) altBtn.disabled = true;

            const indexes = await buildPackIndex(mergedHistory);
            if (indexes.enrichedCount > 0) {
                await saveHistory(mergedHistory, indexes.enrichedKeys);
            }
            await flushReplayCache();

            const alternatives = await findAlternatives(
                freeSlotsArr, indexes, guildMembers, assignedCount,
                alreadyAttackedToday, memberNames
            );
            logAlternatives(alternatives);

            if (alternatives.size > 0) {
                await assignAlternatives(alternatives, guildMembers, assignedCount, modeInfo, mergedHistory);
            } else {
                setPanelTitle('⚔️ Альтернатив не найдено');
                scheduleAutoClose();
            }
            await logReplayCacheStats();
        } catch (error) {
            logPanel(`💥 Ошибка: ${error.message}`, 'error');
        }
    }

/* ================================================================
/  ЭКСПОРТ / ИМПОРТ
/ ================================================================ */
    async function exportHistory() {
        try {
            await initStorage();
            const historyParsed = await loadHistory();
            const replayParsed = await getReplayStorageCache();
            let assignmentParsed = {};
            try {
                const all = await assignmentsApi.getAll();
                for (const a of all) assignmentParsed[a.key] = a;
            } catch (e) { logPanel('⚠️ Не удалось прочитать назначения: ' + e.message, 'warn'); }

            const hDays = Object.keys(historyParsed).length;
            const rCount = Object.keys(replayParsed).length;
            const aCount = Object.keys(assignmentParsed).length;
            if (hDays === 0 && rCount === 0 && aCount === 0) { logPanel('⚠️ Нечего сохранять', 'warn'); return; }

            const payload = {
                version: EXPORT_FORMAT_VERSION,
                exportedAt: new Date().toISOString(),
                scriptVersion: GM_info.script.version,
                history: historyParsed,
                replayCache: replayParsed,
                assignments: assignmentParsed,
            };
            const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `hwh_cw_backup_${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            URL.revokeObjectURL(url);
            logPanel(`💾 Бэкап: история (${hDays}) + кэш (${rCount}) + назначения (${aCount}), ${(blob.size / 1024).toFixed(1)} КБ`, 'success');
        } catch (e) {
            logPanel('❌ Ошибка экспорта: ' + e.message, 'error');
        }
    }

    function importHistory() {
        const input = document.createElement('input');
        input.type = 'file'; input.accept = '.json,application/json'; input.style.display = 'none';
        input.addEventListener('change', async (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) { input.remove(); return; }
            try {
                await initStorage();
                const data = JSON.parse(await file.text());
                if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new Error('Неверный формат');

                let historyData = null, replayData = null, assignData = null;
                if (data.version >= 2 && (data.history || data.replayCache || data.assignments)) {
                    historyData = data.history || null;
                    replayData = data.replayCache || null;
                    assignData = data.assignments || null;
                    logPanel(`📂 Формат v${data.version} (от ${data.exportedAt || '?'})`, 'info');
                } else {
                    historyData = data;
                    logPanel('📂 Файл старого формата (только история)', 'info');
                }

                const parts = [];

                if (historyData) {
                    const existing = await loadHistory();
                    const merged = { ...existing };
                    const changedKeys = new Set();
                    let added = 0, skipped = 0;
                    for (const [key, battles] of Object.entries(historyData)) {
                        if (!Array.isArray(battles)) continue;
                        const existingReplays = new Set((merged[key] || []).map(b => b.replayId));
                        let addedForKey = 0;
                        for (const b of battles) {
                            if (!b || !b.replayId) { skipped++; continue; }
                            if (existingReplays.has(b.replayId)) { skipped++; continue; }
                            if (!merged[key]) merged[key] = [];
                            merged[key].push(b);
                            existingReplays.add(b.replayId);
                            added++; addedForKey++;
                        }
                        if (addedForKey > 0) changedKeys.add(key.trim());
                    }
                    await saveHistory(merged, changedKeys);
                    parts.push(`история: +${added}, пропущено ${skipped}`);
                }

                if (replayData) {
                    const cache = await getReplayStorageCache();
                    let added = 0, updated = 0, skipped = 0;
                    for (const [k, v] of Object.entries(replayData)) {
                        if (!k || !v) { skipped++; continue; }
                        const incomingHasUnits = v?.attackers?.[0]?.units?.length || v?.defenders?.[0]?.units?.length;
                        const existingHasUnits = cache[k]?.attackers?.[0]?.units?.length || cache[k]?.defenders?.[0]?.units?.length;
                        if (cache[k] && !incomingHasUnits) { skipped++; continue; }
                        if (cache[k] && incomingHasUnits) { updated++; }
                        else { added++; }
                        cache[k] = v;
                        replayMemoryCache.set(k, v);
                        dirtyReplayIds.add(k);
                    }
                    await saveReplayCache(cache);
                    replayStorageDirty = false;
                    parts.push(`кэш: +${added}, обновлено ${updated}, пропущено ${skipped}`);
                }

                if (assignData) {
                    const inited = await assignmentsApi.init();
                    if (!inited) {
                        parts.push('назначения: IDB недоступна');
                    } else {
                        let added = 0, skipped = 0;
                        for (const [k, v] of Object.entries(assignData)) {
                            if (!k || !v) { skipped++; continue; }
                            try {
                                const existing = await assignmentsDB.get(k, false);
                                if (existing) { skipped++; continue; }
                                await assignmentsDB.set(k, v);
                                added++;
                            } catch (e) { skipped++; }
                        }
                        parts.push(`назначения: +${added}, пропущено ${skipped}`);
                    }
                }

                logPanel(`📂 Импорт: ${parts.join(' | ')}`, 'success');
                await checkStorageSize();
            } catch (err) {
                logPanel('❌ Ошибка импорта: ' + err.message, 'error');
            } finally { input.remove(); }
        });
        document.body.appendChild(input);
        input.click();
    }

    async function exportAssignments() {
        try {
            const records = await assignmentsApi.getAll();
            if (records.length === 0) { logPanel('⚠️ Нет назначений', 'warn'); return; }
            const payload = { version: 1, exportedAt: new Date().toISOString(), scriptVersion: GM_info.script.version, totalRecords: records.length, records };
            const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `hwh_cw_assignments_${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            URL.revokeObjectURL(url);
            logPanel(`💾 Назначения: ${records.length} ${plural(records.length, ['запись', 'записи', 'записей'])}, ${(blob.size / 1024).toFixed(1)} КБ`, 'success');
        } catch (e) {
            logPanel('❌ Ошибка: ' + e.message, 'error');
        }
    }

/* ================================================================
/  ПОКАЗ ВСЕХ НАЗНАЧЕНИЙ
/ ================================================================ */
    async function showTodayAssignments(season, day) {
        try {
            const records = await assignmentsApi.getByDate(season, day);
            const where = whereLabel(season, day);
            if (records.length === 0) {
                await popup.confirm(`За ${where} назначений (${WAR_MODE_LABEL}) нет.`, [{ msg: 'Ок', result: 0, color: 'green' }]);
                return;
            }
            records.sort((a, b) => a.slotId - b.slotId);
            await hydrateAssignments(records);
            const fmt = (units) => {
                if (!units || units.length === 0) return '<i>нет данных</i>';
                return units.map(u => {
                    const p = [`<b>${u.name || u.id}</b>`];
                    if (u.level) p.push(`L${u.level}`);
                    if (u.star) p.push(`★${u.star}`);
                    if (u.power) p.push(`${Math.round(u.power / 1000)}k`);
                    if (u.petId) p.push(`(${getHeroName(u.petId)})`);
                    return p.join(' ');
                }).join(', ');
            };
            const badge = {
                exact: '<span style="color:#7fff7f;">✅ exact</span>',
                sameDefenderMinor: '<span style="color:#ffd24d;">⚠️ ~пит</span>',
                otherDefenderExact: '<span style="color:#80d4ff;">🔄 ≠ID</span>',
                otherDefenderMinor: '<span style="color:#ff8a80;">🔄⚠️ ≠ID~пит</span>',
            };
            let html = `<div style="max-height:60vh;overflow-y:auto;text-align:left;font-size:13px;">`;
            html += `<div style="color:#80d4ff;margin-bottom:6px;">Режим: <b>${WAR_MODE_LABEL}</b>, ${where}</div>`;
            for (const r of records) {
                const typeLabel = r.slotType === 'titan' ? 'титан' : (r.slotType === 'hero' ? 'герой' : '');

                let extraInfo = '';
                if (typeof r.winProbability === 'number') {
                    const probPercent = Math.round(r.winProbability * 100);
                    const probColor = probPercent >= 70 ? '#7fff7f' : (probPercent >= 50 ? '#ffd24d' : '#ff8a80');
                    extraInfo += ` <span style="color:${probColor};font-weight:bold;" title="Расчётный шанс победы (10 симуляций)">🎲 ${probPercent}%</span>`;
                }
                if (r.replayId) {
                    extraInfo += ` <a href="https://www.hero-wars.com/?replay_id=${r.replayId}" target="_blank" style="color:#80d4ff;text-decoration:none;margin-left:8px;" title="Открыть реплей">🔗 Реплей</a>`;
                }

                html += `<div style="margin-bottom:12px;padding:8px;border:1px solid #8a6d3b;border-radius:6px;">`;
                html += `<div style="color:#ffd24d;font-weight:bold;">${r.slotLocation} — ${r.defenderName} ${badge[r.matchLevel] || ''}${typeLabel ? ` <span style="color:#888;">[${typeLabel}]</span>` : ''}${extraInfo}</div>`;
                html += `<div style="color:#7fff7f;">⚔️ Атакует: <b>${r.memberName}</b></div>`;
                html += `<div style="color:#b8d4e3;">⚔️ ${fmt(r.attackerUnits)}</div>`;
                html += `<div style="color:#ff8a80;">🛡️ ${fmt(r.defenderUnits)}</div>`;
                if (!r.attackerUnits || !r.attackerUnits.length) {
                    html += `<div style="color:#888;font-size:12px;">replayId: ${r.replayId || '?'}</div>`;
                }
                html += `</div>`;
            }
            html += `</div>`;

            const answer = await popup.confirm(html, [
                { msg: '📋 Скопировать', result: 'copy', color: 'green' },
                { msg: 'Ок', result: 'ok', isCancel: true },
            ]);
            if (answer === 'copy') {
                const noLevels = getNoUnitLevels();
                const textLines = records.map(r => {
                    const b = { exact: '✅', sameDefenderMinor: '⚠️ ~пит', otherDefenderExact: '🔄 ≠ID', otherDefenderMinor: '🔄⚠️ ≠ID~пит' };
                    const typeLabel = r.slotType === 'titan' ? ' [титан]' : (r.slotType === 'hero' ? ' [герой]' : '');

                    let extraInfo = '';
                    if (typeof r.winProbability === 'number') {
                        extraInfo += ` | 🎲 Шанс: ${Math.round(r.winProbability * 100)}%`;
                    }
                    if (r.replayId) {
                        extraInfo += ` | 🔗 hero-wars.com/?replay_id=${r.replayId}`;
                    }

                    let line = `📍 ${r.slotLocation}${typeLabel} → ${r.defenderName} ${b[r.matchLevel] || ''}${extraInfo}\n   ⚔️ Атакует: ${r.memberName}`;
                    if (r.attackerUnits && r.attackerUnits.length) {
                        const units = r.attackerUnits.map(u => {
                            let p = u.name;
                            if (!noLevels) {
                                p += ` L${u.level || ''} ★${u.star || ''}`;
                            }
                            if (u.petId) p += ` (${getHeroName(u.petId)})`;
                            return p;
                        }).join(', ');
                        line += `\n   ⚔️ ${units}`;
                    } else {
                        line += `\n   ⚔️ состав не сохранён (replayId: ${r.replayId || '?'})`;
                    }
                    return line;
                });
                const fullText = `🎯 Все назначения (${WAR_MODE_LABEL}) за ${where}:\n\n` + textLines.join('\n\n');
                if (typeof globalThis.HWHFuncs?.copyText === 'function') globalThis.HWHFuncs.copyText(fullText);
                else navigator.clipboard.writeText(fullText);
                await popup.confirm('✅ Все назначения скопированы в буфер обмена!', [{ msg: 'Ок', result: 0, color: 'green' }]);
            }
        } catch (e) { logPanel('❌ ' + e.message, 'error'); }
    }

/* ================================================================
/  POPUP ПРИ ВХОДЕ
/ ================================================================ */
    async function getMyPendingAssignments(season, day) {
        const empty = { pending: [], completed: [], reassigned: [] };
        if (!assignmentsApi.ready) await assignmentsApi.init();
        if (!assignmentsApi.ready) return empty;

        const me = getUserInfo() || {};
        const myId = String(me.id || '');
        if (!myId) return empty;

        try {
            const cw = await Caller.send('clanWarGetInfo');
            if (!cw?.season || !cw?.day || !cw?.enemySlots) return empty;
            if (String(cw.season) !== String(season) || String(cw.day) !== String(day)) return empty;
        } catch (e) {
            logDebug('getMyPendingAssignments: ошибка проверки актуальности — ' + e.message);
            return empty;
        }

        if (!window.__hwhCWGlobalClanMembers || Object.keys(window.__hwhCWGlobalClanMembers).length === 0) {
            try {
                const clanInfo = await Caller.send('clanGetInfo');
                if (clanInfo?.clan?.members) {
                    window.__hwhCWGlobalClanMembers = {};
                    for (const id in clanInfo.clan.members) {
                        const m = clanInfo.clan.members[id];
                        if (m && typeof m === 'object') {
                            window.__hwhCWGlobalClanMembers[id] = m.name || m.nick || String(id);
                        } else if (typeof m === 'string') {
                            window.__hwhCWGlobalClanMembers[id] = m;
                        }
                    }
                }
            } catch (e) { logDebug('clanGetInfo (popup): ' + e.message); }
        }
        const nameOf = (id) => (window.__hwhCWGlobalClanMembers || {})[id] || id;

        const records = await assignmentsApi.getByDate(season, day);
        const mine = records.filter(r => String(r.memberId) === myId);
        if (mine.length === 0) return empty;
        await hydrateAssignments(mine);

        let enemySlots = {};
        const myAttackedSlots = new Set();
        const slotAttackers = new Map();

        try {
            const cwInfo = await Caller.send('clanWarGetInfo');
            if (!cwInfo?.enemySlots) return { pending: [], completed: mine, reassigned: [] };
            enemySlots = cwInfo.enemySlots;

            try {
                const t = await Caller.send({
                    name: 'clanWarGetDayHistory',
                    args: { season: parseInt(season), day: parseInt(day) }
                });
                for (const b of (t?.attack || [])) {
                    if (b.slotId != null && b.attackerId && String(b.attackerId) !== '0') {
                        slotAttackers.set(parseInt(b.slotId), String(b.attackerId));
                    }
                    if (String(b.attackerId) === myId) myAttackedSlots.add(parseInt(b.slotId));
                }
            } catch (e) {}
        } catch (e) {
            logDebug('getMyPendingAssignments: ошибка запроса слотов — ' + e.message);
            return { pending: [], completed: mine, reassigned: [] };
        }

        const pending = [], completed = [], reassigned = [];
        for (const r of mine) {
            const slot = enemySlots[r.slotId];

            if (!slot || slot.status === 'destroyed' || !slot.user) {
                completed.push(r); continue;
            }
            if (myAttackedSlots.has(parseInt(r.slotId))) {
                completed.push(r); continue;
            }

            const markerId = String(slot.targetMarkingUserId || '0');
            const attackerId = String(slot.attackerId || '0');

            if (attackerId === myId) {
                completed.push(r);
            } else if (markerId !== myId) {
                const atkId = slotAttackers.get(parseInt(r.slotId));
                if (atkId) {
                    r._attackedById = atkId;
                    r._attackedByName = nameOf(atkId);
                }
                reassigned.push(r);
            } else {
                pending.push(r);
            }
        }
        return { pending, completed, reassigned };
    }

    function buildAssignmentsHtml(records, season, day, totalAssigned = null, reassigned = [], canAssign = true) {
        if (records.length === 0 && (!reassigned || reassigned.length === 0)) return '';
        const badge = {
            exact: '<span style="color:#7fff7f;font-weight:bold;">✅ exact</span>',
            sameDefenderMinor: '<span style="color:#ffd24d;font-weight:bold;">⚠️ ~пит</span>',
            otherDefenderExact: '<span style="color:#80d4ff;font-weight:bold;">🔄 ≠ID</span>',
            otherDefenderMinor: '<span style="color:#ff8a80;font-weight:bold;">🔄⚠️ ≠ID~пит</span>',
        };
        const where = whereLabel(season, day);

        let html = `<div style="text-align:left;max-height:60vh;overflow-y:auto;font-size:13px;">`;
        html += `<div style="color:#ffd24d;font-weight:bold;margin-bottom:8px;">🎯 Твои цели (${WAR_MODE_LABEL}, ${where})</div>`;

        if (records.length > 0) {
            let counter = `(${records.length})`;
            if (totalAssigned !== null && totalAssigned > records.length) {
                const done = totalAssigned - records.length;
                counter = `<span style="color:#7fff7f;">${done} выполнено</span> · <b>${records.length} осталось</b> из ${totalAssigned}`;
            }
            html += `<div style="color:#b8d4e3;font-size:12px;margin-bottom:6px;">Активных: ${counter}</div>`;

            for (const r of records) {
                const typeLabel = r.slotType === 'titan' ? ' <span style="color:#888;">[титан]</span>' : (r.slotType === 'hero' ? ' <span style="color:#888;">[герой]</span>' : '');

                let extraInfo = '';
                if (typeof r.winProbability === 'number') {
                    const probPercent = Math.round(r.winProbability * 100);
                    const probColor = probPercent >= 70 ? '#7fff7f' : (probPercent >= 50 ? '#ffd24d' : '#ff8a80');
                    extraInfo += ` <span style="color:${probColor};font-weight:bold;" title="Расчётный шанс победы (10 симуляций)">🎲 ${probPercent}%</span>`;
                }
                if (r.replayId) {
                    extraInfo += ` <a href="https://www.hero-wars.com/?replay_id=${r.replayId}" target="_blank" style="color:#80d4ff;text-decoration:none;margin-left:8px;" title="Открыть реплей">🔗 Реплей</a>`;
                }

                html += `<div style="margin-bottom:10px;padding:8px;border:1px solid #8a6d3b;border-radius:6px;">`;
                html += `<div style="color:#ffd24d;font-weight:bold;">📍 ${r.slotLocation} → ${r.defenderName} ${badge[r.matchLevel] || ''}${typeLabel}${extraInfo}</div>`;

                if (r.attackerUnits && r.attackerUnits.length) {
                    const units = r.attackerUnits.map(u => {
                        const p = [`<b>${u.name}</b>`];
                        if (u.level) p.push(`L${u.level}`);
                        if (u.star) p.push(`★${u.star}`);
                        if (u.power) p.push(`${Math.round(u.power / 1000)}k`);
                        return p.join(' ');
                    });
                    html += `<div style="color:#b8d4e3;">⚔️ ${units.join(', ')}</div>`;
                    const pet = r.attackerUnits.find(u => u.petId);
                    if (pet) html += `<div style="color:#80d4ff;">🐾 Питомец: ${getHeroName(pet.petId)}</div>`;
                    const favors = r.attackerUnits.filter(u => u.favorPetId);
                    if (favors.length) {
                        html += `<div style="color:#d4a0ff;">🔮 Покровители: ${favors.map(u => `${u.name}→${getHeroName(u.favorPetId)}`).join(', ')}</div>`;
                    }
                } else {
                    html += `<div style="color:#888;font-size:12px;">⚔️ состав не сохранён (replayId: ${r.replayId || '?'})</div>`;
                }
                html += `</div>`;
            }
        }

        if (reassigned && reassigned.length > 0) {
            if (records.length > 0) {
                html += `<div style="margin:10px 0;border-top:1px dashed #8a6d3b;"></div>`;
            }
            html += `<div style="color:#ff8a80;font-weight:bold;margin-bottom:4px;">🔄 Переназначено (${reassigned.length})</div>`;
            html += `<div style="color:#b8d4e3;font-size:12px;margin-bottom:8px;">`;
            html += `Эти цели ушли — твои попытки освободились. `;
            html += `Обратись к <b>генералу/командующему</b>, чтобы он назначил тебе новую цель.`;
            html += `</div>`;
            for (const r of reassigned) {
                const typeLabel = r.slotType === 'titan' ? ' <span style="color:#888;">[титан]</span>' : (r.slotType === 'hero' ? ' <span style="color:#888;">[герой]</span>' : '');
                html += `<div style="margin-bottom:6px;padding:6px 8px;border:1px solid #5a4628;border-radius:6px;background:rgba(168,50,43,.08);">`;
                html += `<div style="color:#ff8a80;font-weight:bold;">📍 ${r.slotLocation} → ${r.defenderName}${typeLabel}</div>`;
                if (r._attackedByName) {
                    html += `<div style="color:#ffd24d;font-size:12px;">⚔️ Ударил: <b>${r._attackedByName}</b> — попытка освободилась</div>`;
                } else {
                    html += `<div style="color:#ffd24d;font-size:12px;">Метка снята — попытка освободилась</div>`;
                }
                html += `</div>`;
            }
        }

        html += `</div>`;
        return html;
    }

function formatAssignmentsAsText(records, season, day) {
    if (records.length === 0) return '';
    const badge = {
        exact: '✅',
        sameDefenderMinor: '⚠️ ~пит',
        otherDefenderExact: '🔄 ≠ID',
        otherDefenderMinor: '🔄⚠️ ≠ID~пит',
    };
    const noLevels = getNoUnitLevels();
    const where = whereLabel(season, day);
    const lines = [`🎯 Мои цели (${WAR_MODE_LABEL}, ${where}):`, ''];
    for (const r of records) {
        const typeLabel = r.slotType === 'titan' ? ' [титан]' : (r.slotType === 'hero' ? ' [герой]' : '');

        let extraInfo = '';
        if (typeof r.winProbability === 'number') {
            extraInfo += ` | 🎲 Шанс: ${Math.round(r.winProbability * 100)}%`;
        }
        if (r.replayId) {
            extraInfo += ` | 🔗 hero-wars.com/?replay_id=${r.replayId}`;
        }

        lines.push(`📍 ${r.slotLocation}${typeLabel} → ${r.defenderName} ${badge[r.matchLevel] || ''}${extraInfo}`);
        if (r.attackerUnits && r.attackerUnits.length) {
            const units = r.attackerUnits.map(u => {
                const p = [u.name];
                if (!noLevels) {
                    if (u.level) p.push(`L${u.level}`);
                    if (u.star) p.push(`★${u.star}`);
                }
                if (u.power) p.push(`${Math.round(u.power / 1000)}k`);
                if (u.petId) p.push(`(${getHeroName(u.petId)})`);
                return p.join(' ');
            });
            lines.push(`   ⚔️ ${units.join(', ')}`);
        } else {
            lines.push(`   ⚔️ состав не сохранён (replayId: ${r.replayId || '?'})`);
        }
        lines.push('');
    }
    return lines.join('\n');
}

    function copyAssignmentsToClipboard(records, season, day) {
        const text = formatAssignmentsAsText(records, season, day);
        if (!text) return false;
        if (typeof globalThis.HWHFuncs?.copyText === 'function') globalThis.HWHFuncs.copyText(text);
        else if (navigator.clipboard) navigator.clipboard.writeText(text);
        logPanel('📋 Скопировано в буфер обмена', 'success');
        return true;
    }

    async function showMyAssignmentsOnStart() {
        if (!getShowOnStart()) return;

        if (!window.__hwhCWLastInfo) {
            try {
                const saved = JSON.parse(localStorage.getItem('HWH_CW_LastInfo') || 'null');
                if (saved) window.__hwhCWLastInfo = saved;
            } catch (e) {}
        }
        if (!window.__hwhCWLastInfo) return;

        const info = window.__hwhCWLastInfo;

        if (info.mode === 'crossClanWar') {
            logDebug('showMyAssignmentsOnStart: legacy crossClanWar — пропускаем');
            return;
        }

        if (POPUP_COOLDOWN_MINUTES > 0) {
            const lastShown = +localStorage.getItem('HWH_CW_LastPopupShown') || 0;
            const elapsedMin = (Date.now() - lastShown) / 60000;
            if (elapsedMin < POPUP_COOLDOWN_MINUTES) return;
        }

        await sleep(1500);

        const { season, day } = info;
        const { pending, completed, reassigned } = await getMyPendingAssignments(season, day);
        if (pending.length === 0 && reassigned.length === 0) return;

        const total = pending.length + completed.length;
        const html = `<div style="text-align:center;color:#ffd24d;font-weight:bold;margin-bottom:6px;">${WAR_MODE_LABEL}</div>` +
              buildAssignmentsHtml(pending, season, day, total, reassigned, true);

        const buttons = [];
        if (pending.length > 0) {
            buttons.push({ msg: '📋 Скопировать', result: 'copy', color: 'green' });
        }
        buttons.push({ msg: 'Ок', result: 'ok', isCancel: true });

        const answer = await popup.confirm(html, buttons);
        if (answer === 'copy') {
            copyAssignmentsToClipboard(pending, season, day);
            await popup.confirm('<b style="color:#7fff7f;">✅ Скопировано в буфер</b>', [{ msg: 'Ок', result: 0, color: 'green' }]);
        }

        if (POPUP_COOLDOWN_MINUTES > 0) localStorage.setItem('HWH_CW_LastPopupShown', String(Date.now()));
    }

/* ================================================================
/  СНЯТИЕ АКТИВНЫХ НАЗНАЧЕНИЙ
/ ================================================================ */
    async function clearAllAssignments() {
        const answer = await popup.confirm(
            `<div style="color:#ff8a80;font-weight:bold;font-size:14px;">⚠️ Снять назначения (${WAR_MODE_LABEL})?</div>` +
            '<br>Будут сняты метки только с тех слотов, где <b>ещё не было боя</b>.<br>' +
            '<br>История, кэш реплеев и база назначений <b>НЕ удаляются</b>.<br>' +
            '<br><b>Это действие нельзя отменить.</b>',
            [
                { msg: 'Да, снять', result: true, color: 'red' },
                { msg: 'Отмена', result: false, isCancel: true, color: 'green' },
            ]
        );
        if (!answer) return;

        createPanel();
        panelLog.innerHTML = '';
        cancelAutoClose();
        setPanelTitle(`❌ Снятие назначений (${WAR_MODE_LABEL})...`);
        setProgress(0);

        let count = 0;
        let skipped = 0;

        try {
            logPanel('🏰 ВГ: получение данных...', 'info');
            const cw = await Caller.send('clanWarGetInfo');
            if (cw?.enemySlots) {
                const hist = await Caller.send({
                    name: 'clanWarGetDayHistory',
                    args: { season: parseInt(cw.season), day: parseInt(cw.day) }
                });
                const attacked = new Set();
                for (const b of (hist?.attack || [])) {
                    if (b.slotId != null) attacked.add(parseInt(b.slotId));
                }

                let i = 0;
                const slots = Object.entries(cw.enemySlots);
                for (const [slotId, slotData] of slots) {
                    const markerId = String(slotData.targetMarkingUserId || '0');
                    if (markerId !== '0' && markerId !== 'null') {
                        const sid = parseInt(slotId);
                        if (attacked.has(sid)) {
                            skipped++;
                        } else {
                            const res = await setTargetMark('0', sid);
                            if (res.ok) count++;
                            else logPanel(`❌ ВГ #${slotId}: ${JSON.stringify(res.error)}`, 'error');
                        }
                    }
                    setProgress((++i / slots.length) * 100);
                    await sleep(120);
                }
            } else {
                logPanel('🏰 ВГ: война не активна', 'info');
            }
        } catch (e) {
            logPanel('❌ Ошибка при снятии ВГ: ' + e.message, 'error');
        }

        setProgress(100);
        logPanel(`✅ Готово! Снято: ${count}. Пропущено (бой уже был): ${skipped}.`, 'success');
        logPanel('ℹ️ История, кэш реплеев и база назначений не тронуты — данные сохранены.', 'info');
        setPanelTitle(`✅ Снято: ${count}`);
        scheduleAutoClose();
    }

async function showSettings() {
    const showOnStart = getShowOnStart();
    const noUnitLevels = getNoUnitLevels();
    const statusColor = showOnStart ? '#7fff7f' : '#ff8a80';
    const statusText  = showOnStart ? '✅ показывается' : '❌ скрыто';

    const html = `
        <div style="text-align:left;">
            <div style="color:#ffd24d;font-weight:bold;font-size:14px;margin-bottom:10px;">⚙️ Настройки</div>
            <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:10px;border:1px solid #8a6d3b;border-radius:6px;background:rgba(138,109,59,.1);margin-bottom:8px;">
                <input type="checkbox" id="hwh-cw-show-on-start" ${showOnStart ? 'checked' : ''} style="width:18px;height:18px;cursor:pointer;accent-color:#ffd24d;">
                <span>Показывать всплывающее окно при входе</span>
            </label>
            <div id="hwh-cw-settings-status" style="color:${statusColor};font-size:12px;margin-top:2px;margin-bottom:12px;padding-left:4px;">
                Текущее состояние: ${statusText}
            </div>

            <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:10px;border:1px solid #8a6d3b;border-radius:6px;background:rgba(138,109,59,.1);">
                <input type="checkbox" id="hwh-cw-no-unit-levels" ${noUnitLevels ? 'checked' : ''} style="width:18px;height:18px;cursor:pointer;accent-color:#ffd24d;">
                <span>Копировать в буфер без уровня и звёздности героев</span>
            </label>
            <div style="color:#888;font-size:11px;margin-top:6px;padding-left:4px;">
                При включении из текста для копирования убираются отметки <b>L130 ★6</b>. Питомцы, сила и покровители остаются.
            </div>
            <div style="color:#888;font-size:11px;margin-top:10px;padding-left:4px;">
                Окно с твоими целями можно открыть вручную через «📌 Мои назначения» или «📋 Все назначения».
            </div>
        </div>
    `;

    const popupPromise = popup.confirm(html, [{ msg: 'Закрыть', result: 0, color: 'green' }]);

    const bindSettings = (attempts = 0) => {
        const cbShow = document.getElementById('hwh-cw-show-on-start');
        const cbNoLevels = document.getElementById('hwh-cw-no-unit-levels');

        if (cbShow) {
            cbShow.addEventListener('change', (e) => {
                localStorage.setItem(SHOW_ON_START_KEY, e.target.checked ? 'true' : 'false');
                const status = document.getElementById('hwh-cw-settings-status');
                if (status) {
                    status.textContent = `Текущее состояние: ${e.target.checked ? '✅ показывается' : '❌ скрыто'}`;
                    status.style.color = e.target.checked ? '#7fff7f' : '#ff8a80';
                }
                console.log(`%c[HWH CW Cascade] ⚙️ Всплывающее окно при входе: ${e.target.checked ? 'включено' : 'отключено'}`,
                            e.target.checked ? 'color:#7fff7f;' : 'color:#ff8a80;');
            });
        }

        if (cbNoLevels) {
            cbNoLevels.addEventListener('change', (e) => {
                localStorage.setItem(NO_UNIT_LEVELS_KEY, e.target.checked ? 'true' : 'false');
                console.log(`%c[HWH CW Cascade] ⚙️ Копирование без уровня/звёзд: ${e.target.checked ? 'включено' : 'отключено'}`,
                            e.target.checked ? 'color:#7fff7f;' : 'color:#ff8a80;');
            });
        }

        if (cbShow && cbNoLevels) return;
        if (attempts < 30) setTimeout(() => bindSettings(attempts + 1), 50);
    };
    setTimeout(() => bindSettings(), 50);

    await popupPromise;
}
    async function showMainActionMenu() {
        const canAssign = await canAssignTargets();

        const buttons = [];
        if (canAssign) {
            buttons.push({ msg: '⚔️ Расставить ВГ', result: 'assign_wg', color: 'green' });
            buttons.push({ msg: '❌ Снять ВГ', result: 'clear_wg', color: 'orange' });
        }
        buttons.push({ msg: '📋 Открыть панель', result: 'open_panel', color: 'brown' });
        buttons.push({ msg: '⚙️ Настройки', result: 'settings', color: 'brown' });

        let header = '<b style="color:#ffd24d;font-size:15px;">Выберите действие:</b>';
        if (!canAssign) {
            header += `<div style="color:#ff8a80;font-size:12px;margin-top:6px;">`;
            header += `⚠️ Расстановка доступна только главе и генералам клана.<br>`;
            header += `Ты можешь смотреть свои цели через «📌 Мои назначения» или «📋 Все назначения».`;
            header += `</div>`;
        }

        const answer = await popup.confirm(header, buttons);

        if (!answer) return;

        if (answer === 'assign_wg') await autoAssignGuildTargets();
        else if (answer === 'clear_wg') await clearAllAssignments();
        else if (answer === 'settings') await showSettings();
        else if (answer === 'open_panel') {
            createPanel();
            if (panel && panelMinimized) {
                panelMinimized = false;
                panel.classList.remove('minimized');
                const minBtn = panel.querySelector('.hwh-cw-panel-btn[title="Свернуть/развернуть"]');
                if (minBtn) minBtn.textContent = '—';
            }
        }
    }

/* ================================================================
/  РЕГИСТРАЦИЯ КНОПОК И ХУК ЗАГРУЗКИ
/ ================================================================ */
    function registerButton() {
        const list = window.HWHData && window.HWHData.actionsPopupButtons;
        if (!list || typeof window.Caller === 'undefined') return false;

        if (list.some((b) => b && b.hwhGuildAutoTargetCascade)) return true;

        const button = {
            hwhGuildAutoTargetCascade: true,
            msg: '🎯 Авто-цели ВГ',
            title: 'Управление назначениями: расстановка и снятие целей для ВГ.',
            color: 'purple',
            async result() {
                await sleep(300);
                await showMainActionMenu();
            }
        };

        const idx = list.findIndex((b) => b && b.isClose);
        if (idx === -1) {
            list.push(button);
        } else {
            list.splice(idx, 0, button);
        }

        console.log('[HWH CW Cascade] ✅ Добавлена кнопка "🎯 Авто-цели ВГ"');
        return true;
    }
    registerButton();

    function setupStartGameHook() {
        let popupShown = false;
        let bgStarted = false;

        const showPopup = async () => {
            if (popupShown) return;
            popupShown = true;
            if (!getShowOnStart()) return;
            try { await showMyAssignmentsOnStart(); } catch (e) { console.warn(e); }
        };

        const runBackgroundTasks = () => {
            if (bgStarted) return;
            bgStarted = true;
            setTimeout(() => {
                backgroundAutoEnrich().catch(e => console.warn(e));
            }, 15000);
        };

        if (getUserInfo()?.id) {
            showPopup();
            runBackgroundTasks();
            return;
        }

        if (Events && typeof Events.on === 'function') {
            Events.on('startGame', async () => {
                await showPopup();
                runBackgroundTasks();
            });
        }

        setTimeout(() => {
            if (!popupShown && !bgStarted && getUserInfo()?.id) {
                console.log('%c[HWH CW Cascade] startGame не выстрелил — запускаю задачи принудительно', 'color: #888;');
                showPopup();
                runBackgroundTasks();
            }
        }, 30000);
    }
    setupStartGameHook();

})();
