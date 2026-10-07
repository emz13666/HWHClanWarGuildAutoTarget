// ==UserScript==
// @name         HWHClanWarGuildAutoTarget
// @name:ru      Авто-цели ВГ для гильдии
// @namespace    HWHClanWarGuildAutoTarget
// @version      4.14
// @description  Automatically assigns Clan War targets to all guild members based on past full victories (+20 points). Matches hero/titan types.
// @description:ru Автоматически назначает цели в Войне Гильдий всем членам гильдии по истории полных побед (+20 очков). Учитывает типы пачек (герои/титаны).
// @author       emz13666
// @license      MIT
// @icon         data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiNmZmQyNGQiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cGF0aCBkPSJNMTQuNSAxNy41TDMgNlYzaDNsMTEuNSAxMS41Ii8+PHBhdGggZD0ibTEzIDE5IDYtNiIvPjxwYXRoIGQ9Ik0xNiAxNmw0IDQiLz48cGF0aCBkPSJNMTkgMjFsMi0yIi8+PHBhdGggZD0iTTkuNSAxNy41IDIxIDZWM2gtM0w2LjUgMTQuNSIvPjxwYXRoIGQ9Im0xMSAxOS02LTYiLz48cGF0aCBkPSJNOCAxNmwtNCA0Ii8+PHBhdGggZD0iTTUgMjFsLTItMiIvPjwvc3ZnPg==
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
    const MAX_HISTORY_DAYS = 90;
    const AUTO_CLOSE_DELAY_MS = 5000;

    /* ================================================================ */
    /* 🔥 ОЖИДАНИЕ ЗАГРУЗКИ HWH                                       */
    /* ================================================================ */
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

    // 🔥 Официальная регистрация расширения в HWH
    console.log(`%cStart Extension ${GM_info.script.name}, v${GM_info.script.version} by ${GM_info.script.author}`, 'color: #ffd24d');
    try {
        const { addExtentionName } = HWHFuncs;
        addExtentionName(GM_info.script.name, GM_info.script.version, GM_info.script.author);
    } catch (e) {
        console.warn('[HWHClanWarGuildAutoTarget] Не удалось зарегистрировать расширение в HWH:', e);
    }

    /* ================================================================ */
    /* 🗄️ РАБОТА С ЛОКАЛЬНОЙ БАЗОЙ ИСТОРИИ                            */
    /* ================================================================ */
    function loadHistory() {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
        catch (e) { logPanel('Ошибка чтения истории, начинаем с нуля', 'warn'); return {}; }
    }

    function saveHistory(history) {
        try {
            const keys = Object.keys(history).sort().reverse();
            const pruned = {};
            keys.slice(0, MAX_HISTORY_DAYS).forEach(k => { pruned[k] = history[k]; });
            localStorage.setItem(STORAGE_KEY, JSON.stringify(pruned));
            logPanel(`💾 База истории: ${Object.keys(pruned).length} дней (макс. ${MAX_HISTORY_DAYS})`, 'info');
        } catch (e) {
            logPanel('Ошибка сохранения истории: ' + e.message, 'error');
        }
    }

    function isFullWin(battle) {
        if (!battle.win) return false;
        if (battle.slotPoints === undefined || battle.slotPoints === null) return true; // Обратная совместимость
        return battle.slotPoints === 20;
    }

    function mergeAndSaveHistory(newData) {
        const history = loadHistory();
        let updated = false, newFullWins = 0, newFinishWins = 0;
        
        for (const [key, battles] of Object.entries(newData)) {
            if (!history[key]) history[key] = [];
            const existingReplays = new Set(history[key].map(b => b.replayId));
            
            for (const battle of battles) {
                if (!battle.win || existingReplays.has(battle.replayId)) continue;
                
                if (battle.slotPoints === 20) {
                    history[key].push({
                        attackerId: String(battle.attackerId),
                        defenderId: String(battle.defenderId),
                        replayId: battle.replayId,
                        win: true,
                        slotPoints: 20,
                        time: battle.time
                    });
                    newFullWins++;
                    updated = true;
                } else {
                    newFinishWins++;
                }
            }
        }
        
        if (updated) saveHistory(history);
        if (newFullWins > 0 || newFinishWins > 0) {
            logPanel(`📥 Новых полных побед: ${newFullWins}, отфильтровано добивов: ${newFinishWins}`, 'info');
        }
        return history;
    }

    /* ================================================================ */
    /* 🖥️ ИНФОРМАЦИОННАЯ ПАНЕЛЬ                                       */
    /* ================================================================ */
    let panel = null, panelLog = null, panelProgress = null, panelTitle = null;
    let panelMinimized = false, autoCloseTimer = null;

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
            style.textContent = `
                .hwh-cw-panel { position: fixed; top: 20px; right: 20px; width: 380px; max-height: 70vh; background: rgba(30, 25, 18, 0.95); border: 2px solid #8a6d3b; border-radius: 8px; color: #f3e3bd; font-family: Arial, sans-serif; font-size: 12px; z-index: 2147483000; box-shadow: 0 4px 20px rgba(0,0,0,0.5); display: flex; flex-direction: column; pointer-events: auto; }
                .hwh-cw-panel.minimized { max-height: 36px; overflow: hidden; }
                .hwh-cw-panel-header { display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; background: #3d2e1a; border-bottom: 1px solid #8a6d3b; border-radius: 6px 6px 0 0; cursor: move; user-select: none; }
                .hwh-cw-panel-title { font-weight: bold; font-size: 13px; color: #ffd24d; }
                .hwh-cw-panel-controls { display: flex; gap: 4px; }
                .hwh-cw-panel-btn { background: #5a4628; border: 1px solid #8a6d3b; color: #f3e3bd; width: 22px; height: 22px; border-radius: 3px; cursor: pointer; font-size: 12px; line-height: 1; padding: 0; }
                .hwh-cw-panel-btn:hover { background: #7a5f38; }
                .hwh-cw-panel-btn.close:hover { background: #a8322b; }
                .hwh-cw-panel-body { flex: 1; overflow-y: auto; padding: 8px; max-height: calc(70vh - 80px); }
                .hwh-cw-panel-progress { height: 6px; background: #1a140d; border-top: 1px solid #8a6d3b; border-bottom: 1px solid #8a6d3b; }
                .hwh-cw-panel-progress-bar { height: 100%; width: 0; background: linear-gradient(90deg, #3d8f2f, #5cb85c); transition: width 0.2s; }
                .hwh-cw-log-line { padding: 2px 4px; margin: 1px 0; border-radius: 2px; line-height: 1.3; word-wrap: break-word; }
                .hwh-cw-log-line.info { color: #b8d4e3; }
                .hwh-cw-log-line.success { color: #7fff7f; background: rgba(61, 143, 47, 0.15); }
                .hwh-cw-log-line.warn { color: #ffd24d; }
                .hwh-cw-log-line.error { color: #ff8a80; background: rgba(168, 50, 43, 0.15); }
                .hwh-cw-log-line.highlight { color: #fff; background: rgba(138, 109, 59, 0.3); font-weight: bold; }
                .hwh-cw-panel-body::-webkit-scrollbar { width: 6px; }
                .hwh-cw-panel-body::-webkit-scrollbar-track { background: #1a140d; }
                .hwh-cw-panel-body::-webkit-scrollbar-thumb { background: #8a6d3b; border-radius: 3px; }
            `;
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
        if (panel) { panel.remove(); panel = null; panelLog = null; panelProgress = null; panelTitle = null; }
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
        while (panelLog.children.length > 200) panelLog.removeChild(panelLog.firstChild);
        panelLog.scrollTop = panelLog.scrollHeight;
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

    /* ================================================================ */
    /* ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ                                        */
    /* ================================================================ */
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

    /* ================================================================ */
    /* ОСНОВНАЯ ЛОГИКА                                                */
    /* ================================================================ */
    async function autoAssignGuildTargets() {
        createPanel();
        panelLog.innerHTML = '';
        cancelAutoClose();
        setPanelTitle('🎯 Авто-цели ВГ: запуск...');
        setProgress(0);

        try {
            if (typeof Caller === 'undefined' || typeof Caller.send === 'undefined') {
                logPanel('⚠️ HeroWarsHelper (Caller) не найден.', 'error');
                scheduleAutoClose();
                return;
            }

            logPanel('📡 Запрос clanWarGetInfo...', 'info');
            const cwInfo = await Caller.send('clanWarGetInfo');
            if (!cwInfo || !cwInfo.enemySlots) {
                logPanel('⚠️ Война Гильдий не активна.', 'warn');
                scheduleAutoClose();
                return;
            }

            const enemySlots = cwInfo.enemySlots;
            const clanTries = cwInfo.clanTries || {};
            const currentSeason = cwInfo.season;
            const currentDay = cwInfo.day;

            const memberNames = {};
            if (cwInfo.ourSlots) for (const s of Object.values(cwInfo.ourSlots)) if (s.user) memberNames[s.user.id] = s.user.name;
            if (cwInfo.ourClanMembers) for (const m of Object.values(cwInfo.ourClanMembers)) memberNames[m.id] = m.name;
            if (cwInfo.enemyClanMembers) for (const m of Object.values(cwInfo.enemyClanMembers)) memberNames[m.id] = m.name;
            for (const s of Object.values(enemySlots)) if (s.user) memberNames[s.user.id] = s.user.name;

            logPanel(`📊 Сезон/День: ${currentSeason}/${currentDay}, мои попытки: ${cwInfo.myTries}`, 'info');

            const guildMembers = [];
            let totalTries = 0;
            for (const userId of Object.keys(clanTries)) {
                if (userId === "clan") continue;
                const tries = parseInt(clanTries[userId]);
                if (tries > 0) {
                    guildMembers.push({ id: userId, tries });
                    totalTries += tries;
                    logPanel(`👤 ${memberNames[userId] || userId}: попыток = ${tries}`, 'info');
                }
            }
            guildMembers.sort((a, b) => b.tries - a.tries);
            logPanel(`✅ ${guildMembers.length} членов гильдии, всего ${totalTries} попыток`, 'success');

            if (guildMembers.length === 0) {
                logPanel('⚠️ Нет попыток для атаки.', 'warn');
                scheduleAutoClose();
                return;
            }

            const enemyUserIds = new Set();
            for (const slot of Object.values(enemySlots)) {
                if (slot.user?.id) enemyUserIds.add(String(slot.user.id));
            }
            logPanel(`👥 ${enemyUserIds.size} вражеских игроков в текущей войне`, 'info');

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
                        if (enemyUserIds.has(defId)) {
                            alreadyAttackedToday.add(defId);
                            const defName = memberNames[defId] || defId;
                            const atkName = memberNames[String(battle.attackerId)] || battle.attackerId;
                            logPanel(`  🛡️ ${defName}: атакован сегодня (${atkName})`, 'warn');
                        }
                    }
                }
            } catch (e) {
                logPanel('Не удалось получить историю текущего дня: ' + e.message, 'warn');
            }
            logPanel(`🛡️ Итого атакованы сегодня: ${alreadyAttackedToday.size} противников`, 'info');

            const freeSlots = new Map();
            const skippedSlots = [];
            for (const [slotId, slotData] of Object.entries(enemySlots)) {
                const defenderId = slotData.user?.id ? String(slotData.user.id) : null;
                if (!defenderId) continue;

                const defenderName = slotData.user?.name || 'N/A';
                const isMarkFree = !slotData.targetMarkingUserId || String(slotData.targetMarkingUserId) === "0";
                const isAttackerFree = !slotData.attackerId || String(slotData.attackerId) === "0";
                const isReady = slotData.status === "ready";
                const isNotAttackedToday = !alreadyAttackedToday.has(defenderId);
                const isFree = isMarkFree && isAttackerFree && isReady && isNotAttackedToday;

                if (isFree) {
                    const teamObj = slotData.team?.[0] || {};
                    const teamString = getTeamSignature(teamObj);
                    const teamType = getTeamType(teamObj);
                    freeSlots.set(parseInt(slotId), { slotId: parseInt(slotId), defenderId, teamString, teamType, defenderName });
                } else {
                    const reasons = [];
                    if (!isMarkFree) reasons.push(`targetMark=${slotData.targetMarkingUserId}`);
                    if (!isAttackerFree) reasons.push(`attacker=${slotData.attackerId}`);
                    if (!isReady) reasons.push(`status=${slotData.status}`);
                    if (!isNotAttackedToday) reasons.push(`атакован сегодня`);
                    skippedSlots.push({ slotId, defenderId, defenderName, reasons });
                }
            }
            
            logPanel(`🎯 ${freeSlots.size} свободных слотов (пропущено ${skippedSlots.length})`, 'info');
            if (skippedSlots.length > 0) {
                logPanel('⏭️ Пропущенные слоты:', 'warn');
                for (const s of skippedSlots) logPanel(`  • #${s.slotId} ${s.defenderName}: ${s.reasons.join(', ')}`, 'warn');
            }

            if (freeSlots.size === 0) {
                logPanel('⚠️ Нет свободных слотов.', 'warn');
                scheduleAutoClose();
                return;
            }

            logPanel('📜 Запрос clanWarGetAvailableHistory...', 'info');
            setProgress(10);
            const historyList = await Caller.send('clanWarGetAvailableHistory');
            if (!historyList?.history?.length) {
                logPanel('⚠️ История боёв пуста.', 'warn');
                scheduleAutoClose();
                return;
            }

            const recentHistory = historyList.history.slice(0, 7);
            const newDataToMerge = {};
            let loadedDays = 0;
            for (const hist of recentHistory) {
                try {
                    const dayHistory = await Caller.send({
                        name: 'clanWarGetDayHistory',
                        args: { season: parseInt(hist.season), day: parseInt(hist.day) }
                    });
                    if (dayHistory?.attack) newDataToMerge[`${hist.season}_${hist.day}`] = dayHistory.attack;
                    loadedDays++;
                    setProgress(10 + (loadedDays / recentHistory.length) * 20);
                    await sleep(100);
                } catch (e) {
                    logPanel(`Не удалось загрузить день ${hist.season}_${hist.day}`, 'warn');
                }
            }

            const mergedHistory = mergeAndSaveHistory(newDataToMerge);
            const historyKeys = Object.keys(mergedHistory).sort().reverse();

            let totalFullWins = 0, totalWinsVsCurrentGuild = 0;
            for (const key of historyKeys) {
                for (const b of (mergedHistory[key] || [])) {
                    if (isFullWin(b)) {
                        totalFullWins++;
                        if (enemyUserIds.has(b.defenderId)) totalWinsVsCurrentGuild++;
                    }
                }
            }
            logPanel(`📚 В базе ${historyKeys.length} дней, ${totalFullWins} побед (против текущей гильдии: ${totalWinsVsCurrentGuild}). Ищем цели...`, 'highlight');

            const replayCache = new Map();
            async function getReplayInfo(replayId) {
                if (replayCache.has(replayId)) return replayCache.get(replayId);
                try {
                    const replay = await Caller.send({ name: 'battleGetReplay', args: { id: replayId } });
                    const pastDefenders = replay?.replay?.defenders;
                    if (!pastDefenders || pastDefenders.length === 0) {
                        replayCache.set(replayId, []);
                        return [];
                    }
                    const defenderTeams = [];
                    for (const defTeam of pastDefenders) {
                        const teamString = getTeamSignature(defTeam);
                        const teamType = getTeamType(defTeam);
                        if (teamString && teamType) defenderTeams.push({ teamString, teamType });
                    }
                    replayCache.set(replayId, defenderTeams);
                    return defenderTeams;
                } catch (e) {
                    logPanel(`Не удалось загрузить реплей ${replayId}`, 'warn');
                    return [];
                }
            }

            const assigned = [];
            const skipped = [];
            const totalMembers = guildMembers.length;

            for (let mi = 0; mi < guildMembers.length; mi++) {
                const member = guildMembers[mi];
                const memberName = memberNames[member.id] || member.id;
                setPanelTitle(`🎯 ${memberName} (${mi + 1}/${totalMembers}) [${member.tries} попыт.]`);
                setProgress(30 + ((mi / totalMembers) * 65));

                if (freeSlots.size === 0) {
                    skipped.push(`${memberName}: нет свободных слотов`);
                    break;
                }

                const defendersWithWins = new Set();
                for (const key of historyKeys) {
                    const battles = mergedHistory[key] || [];
                    for (const b of battles) {
                        if (b.attackerId === member.id && isFullWin(b) && enemyUserIds.has(b.defenderId)) {
                            defendersWithWins.add(b.defenderId);
                        }
                    }
                }
                
                if (defendersWithWins.size > 0) {
                    const namesList = [...defendersWithWins].map(id => memberNames[id] || id).join(', ');
                    logPanel(`📚 ${memberName} (${member.tries} попыт.): победы в базе против: ${namesList}`, 'info');
                } else {
                    logPanel(`📚 ${memberName} (${member.tries} попыт.): побед в базе против текущей гильдии НЕТ`, 'warn');
                }

                let foundCount = 0;
                const foundDefenderSlots = new Set();

                for (const key of historyKeys) {
                    if (foundCount >= member.tries) break;
                    if (freeSlots.size === 0) break;
                    
                    const battles = mergedHistory[key];
                    if (!battles) continue;

                    const memberWins = battles.filter(b => b.attackerId === member.id && isFullWin(b) && enemyUserIds.has(b.defenderId));
                    if (memberWins.length === 0) continue;

                    logPanel(`📖 ${memberName}: ${memberWins.length} побед (день ${key})`, 'info');

                    for (let i = memberWins.length - 1; i >= 0; i--) {
                        if (foundCount >= member.tries) break;
                        if (freeSlots.size === 0) break;
                        
                        const win = memberWins[i];
                        const defenderId = win.defenderId;
                        if (foundDefenderSlots.has(defenderId)) continue;

                        const pastDefenderTeams = await getReplayInfo(win.replayId);
                        if (pastDefenderTeams.length === 0) continue;

                        for (const [slotId, slot] of freeSlots.entries()) {
                            if (foundCount >= member.tries) break;
                            if (slot.defenderId !== defenderId) continue;

                            const matchingTeam = pastDefenderTeams.find(pastTeam => pastTeam.teamType === slot.teamType && pastTeam.teamString === slot.teamString);

                            if (matchingTeam) {
                                logPanel(`✅ ${memberName} → #${slotId} (${slot.defenderName}) [${slot.teamType}] (${foundCount + 1}/${member.tries})`, 'success');
                                try {
                                    const result = await Caller.send({ name: 'clanWarSetTargetMark', args: { userId: member.id, slotId: slot.slotId } });
                                    const isSuccess = result === null || result === undefined || !result.error;

                                    if (isSuccess) {
                                        assigned.push({ memberId: member.id, memberName, slotId: slot.slotId, defenderId, defenderName: slot.defenderName, teamType: slot.teamType });
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
                            }
                        }
                        await sleep(150);
                    }
                }

                if (foundCount < member.tries) {
                    skipped.push(`${memberName}: назначено ${foundCount} из ${member.tries} целей`);
                    logPanel(foundCount === 0 ? `⏭️ ${memberName}: ни одна цель не найдена` : `⚠️ ${memberName}: назначено только ${foundCount} из ${member.tries} целей`, 'warn');
                }
                await sleep(100);
            }

            setProgress(100);
            logPanel('━'.repeat(30), 'info');
            logPanel(`🏁 ИТОГО: Назначено ${assigned.length} целей, пропущено ${skipped.length} игроков`, 'highlight');
            
            if (assigned.length > 0) {
                logPanel('✅ Назначения:', 'success');
                for (const a of assigned) logPanel(`  • ${a.memberName} → #${a.slotId} ${a.defenderName} [${a.teamType}]`, 'success');
            }
            if (skipped.length > 0) {
                logPanel('⚠️ Пропущено:', 'warn');
                for (const s of skipped) logPanel(`  • ${s}`, 'warn');
            }
            setPanelTitle(`🎯 Готово: ${assigned.length} целей назначено`);

        } catch (error) {
            logPanel(`💥 Критическая ошибка: ${error.message}`, 'error');
            setPanelTitle('🎯 Ошибка');
        }

        scheduleAutoClose();
    }

    /* ================================================================ */
    /* РЕГИСТРАЦИЯ КНОПКИ                                               */
    /* ================================================================ */
    function registerButton() {
        const list = window.HWHData && window.HWHData.actionsPopupButtons;
        if (!list || typeof window.Caller === 'undefined') return false;
        if (list.some((b) => b && b.hwhGuildAutoTarget)) return true;

        const button = {
            hwhGuildAutoTarget: true,
            msg: '🎯 Авто-цели для гильдии',
            title: 'Назначает по 1 цели на каждую попытку игрока. Панель закрывается через 5 сек.',
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
