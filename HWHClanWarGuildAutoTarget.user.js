// ==UserScript==
// @name         HWHClanWarGuildAutoTarget
// @name:ru      Авто-цели ВГ для гильдии
// @namespace    HWHClanWarGuildAutoTarget
// @version      4.29
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
 const MAX_HISTORY_DAYS = 90;
 const AUTO_CLOSE_DELAY_MS = 5000;
 const DEBUG_MODE = true;
 const LOCALSTORAGE_LIMIT_MB = 5;
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
 console.log(`%cStart Extension ${GM_info.script.name}, v${GM_info.script.version} by ${GM_info.script.author}`, 'color: #ffd24d');
 try {
     const { addExtentionName } = HWHFuncs;
     addExtentionName(GM_info.script.name, GM_info.script.version, GM_info.script.author);
 } catch (e) {
     console.warn('[HWHClanWarGuildAutoTarget] Не удалось зарегистрировать расширение в HWH:', e);
 }
 /* ================================================================ */
 /* 📊 ПРОВЕРКА ОБЪЁМА LOCALSTORAGE                                 */
 /* ================================================================ */
 function checkStorageSize() {
     try {
         let totalBytes = 0;
         let historyBytes = 0;
         let historyChars = 0;
         let keysCount = 0;
         for (let i = 0; i < localStorage.length; i++) {
             const key = localStorage.key(i);
             const value = localStorage.getItem(key) || '';
             const bytes = value.length * 2;
             totalBytes += bytes;
             keysCount++;
             if (key === STORAGE_KEY) {
                 historyBytes = bytes;
                 historyChars = value.length;
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
         console.group(`%c[HWH CW Auto] 📊 Состояние localStorage`, 'color: #ffd24d; font-weight: bold');
         console.log(`%c🗄️ История ВГ (ключ "${STORAGE_KEY}"):`, 'color: #7fff7f');
         console.log(`   • Символов : ${historyChars.toLocaleString('ru-RU')}`);
         console.log(`   • Размер   : ${formatBytes(historyBytes)}`);
         console.log(`   • Доля     : ${historyPercent}% от всего localStorage`);
         console.log(`%c📦 Общий объём localStorage:`, 'color: #b8d4e3');
         console.log(`   • Ключей   : ${keysCount}`);
         console.log(`   • Занято   : ${formatBytes(totalBytes)} (${percentUsed}%)`);
         console.log(`   • Свободно : ${formatBytes(freeBytes)} из ${formatBytes(limitBytes)}`);
         if (totalBytes / limitBytes > 0.8) {
             console.warn(`%c⚠️ Внимание: хранилище заполнено более чем на 80%!`, 'color: #ffd24d; font-weight: bold');
         }
         console.groupEnd();
     } catch (e) {
         console.error('[HWH CW Auto] Ошибка при проверке localStorage:', e);
     }
 }
 checkStorageSize();
 /* ================================================================ */
 /* 🗄️ РАБОТА С ЛОКАЛЬНОЙ БАЗОЙ ИСТОРИИ                            */
 /* ================================================================ */
 function loadHistory() {
     try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
     catch (e) { logPanel('Ошибка чтения истории, начинаем с нуля', 'warn'); return {}; }
 }
 /* 🔥 v4.29: Очистка пустых боёв и дубликатов при сохранении */
 function saveHistory(history) {
     try {
         const keys = Object.keys(history).sort().reverse();
         const pruned = {};
         let cleanedCount = 0;
         
         keys.slice(0, MAX_HISTORY_DAYS).forEach(k => {
             const cleanKey = k.trim(); // Убираем возможные артефакты вроде пробелов в конце ключа ("202640_5 ")
             const battles = Array.isArray(history[k]) ? history[k] : [];
             const cleanBattles = battles.filter(b => !isEmptyBattle(b));
             
             if (cleanBattles.length < battles.length) {
                 cleanedCount += (battles.length - cleanBattles.length);
             }
             
             if (cleanBattles.length > 0) {
                 if (!pruned[cleanKey]) pruned[cleanKey] = [];
                 pruned[cleanKey].push(...cleanBattles);
             }
         });
         
         // Дополнительная защита: убираем дубликаты replayId внутри каждого дня на случай слияния ключей
         for (const k in pruned) {
             const seen = new Set();
             pruned[k] = pruned[k].filter(b => {
                 if (seen.has(b.replayId)) return false;
                 seen.add(b.replayId);
                 return true;
             });
         }
         
         localStorage.setItem(STORAGE_KEY, JSON.stringify(pruned));
         
         if (cleanedCount > 0) {
             logPanel(`🧹 При сохранении очищено ${cleanedCount} "пустых" боёв из старых данных`, 'info');
         }
         logPanel(`💾 База истории: ${Object.keys(pruned).length} дней (макс. ${MAX_HISTORY_DAYS})`, 'info');
     } catch (e) {
         logPanel('Ошибка сохранения истории: ' + e.message, 'error');
     }
 }
 function isFullWin(battle) {
     if (!battle.win) return false;
     if (battle.slotPoints === undefined || battle.slotPoints === null) return true;
     return battle.slotPoints === 20;
 }
 /* 🔥 v4.28: Проверка "пустого" боя по replayId (0 = незащищённая позиция) */
 function isEmptyBattle(battle) {
     if (!battle || typeof battle !== 'object') return true;
     const replayId = String(battle.replayId ?? '');
     return replayId === '0' || replayId === '';
 }
 function mergeAndSaveHistory(newData) {
     const history = loadHistory();
     let updated = false, newBattles = 0, skippedDuplicates = 0, skippedEmpty = 0, skippedEmptyDays = 0;
     for (const [key, battles] of Object.entries(newData)) {
         /* 🔥 v4.28: Сначала собираем только валидные новые бои для этого дня */
         const validNewBattles = [];
         const existingReplays = new Set((history[key] || []).map(b => b.replayId));
         for (const battle of battles) {
             if (isEmptyBattle(battle)) {
                 skippedEmpty++;
                 continue;
             }
             if (existingReplays.has(battle.replayId)) {
                 skippedDuplicates++;
                 continue;
             }
             validNewBattles.push({
                 attackerId: String(battle.attackerId),
                 defenderId: String(battle.defenderId),
                 replayId: battle.replayId,
                 win: battle.win,
                 slotPoints: battle.slotPoints,
                 time: battle.time
             });
             existingReplays.add(battle.replayId);
         }
         /* 🔥 v4.28: Если в дне нет ни одного валидного боя — ключ не создаём */
         if (validNewBattles.length === 0) {
             if (!history[key] || history[key].length === 0) {
                 skippedEmptyDays++;
             }
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
 /* ================================================================ */
 /* 💾 ЭКСПОРТ / 📂 ИМПОРТ ИСТОРИИ                                  */
 /* ================================================================ */
 function exportHistory() {
     try {
         const data = localStorage.getItem(STORAGE_KEY) || '{}';
         const parsed = JSON.parse(data);
         const daysCount = Object.keys(parsed).length;
         if (daysCount === 0) {
             logPanel('⚠️ История пуста — нечего сохранять', 'warn');
             return;
         }
         const blob = new Blob([JSON.stringify(parsed, null, 2)], { type: 'application/json' });
         const url = URL.createObjectURL(blob);
         const a = document.createElement('a');
         const date = new Date().toISOString().slice(0, 10);
         a.href = url;
         a.download = `hwh_cw_history_${date}.json`;
         document.body.appendChild(a);
         a.click();
         document.body.removeChild(a);
         URL.revokeObjectURL(url);
         logPanel(`💾 История экспортирована в файл: ${daysCount} дней`, 'success');
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
             let validEntries = 0;
             let skippedEmpty = 0;
             for (const [key, value] of Object.entries(data)) {
                 if (!Array.isArray(value)) {
                     throw new Error(`Неверный формат данных в ключе: ${key}`);
                 }
                 validEntries++;
             }
             const existing = loadHistory();
             const merged = { ...existing };
             for (const [key, battles] of Object.entries(data)) {
                 /* 🔥 v4.28: При импорте также фильтруем пустые бои */
                 const validNewBattles = [];
                 const existingReplays = new Set((merged[key] || []).map(b => b.replayId));
                 for (const b of battles) {
                     if (isEmptyBattle(b)) {
                         skippedEmpty++;
                         continue;
                     }
                     if (b && b.replayId && !existingReplays.has(b.replayId)) {
                         validNewBattles.push(b);
                         existingReplays.add(b.replayId);
                     }
                 }
                 /* 🔥 v4.28: Если в дне нет валидных боёв — ключ не создаём */
                 if (validNewBattles.length === 0) continue;
                 if (!merged[key]) merged[key] = [];
                 merged[key].push(...validNewBattles);
             }
             /* 🔥 v4.29: saveHistory теперь сам вычистит старые пустые бои из merged */
             saveHistory(merged);
             let msg = `📥 История импортирована из "${file.name}": ${validEntries} дней`;
             if (skippedEmpty > 0) msg += `, пропущено пустых боёв: ${skippedEmpty}`;
             logPanel(msg, 'success');
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
             .hwh-cw-panel { position: fixed; top: 20px; right: 20px; width: 450px; max-height: 70vh; background: rgba(30, 25, 18, 0.95); border: 2px solid #8a6d3b; border-radius: 8px; color: #f3e3bd; font-family: Arial, sans-serif; font-size: 12px; z-index: 2147483000; box-shadow: 0 4px 20px rgba(0,0,0,0.5); display: flex; flex-direction: column; pointer-events: auto; }
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
             .hwh-cw-log-line.team-names { color: #ffd24d; font-style: italic; font-size: 11px; padding-left: 12px; }
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
     const exportBtn = document.createElement('button');
     exportBtn.className = 'hwh-cw-panel-btn';
     exportBtn.textContent = '💾';
     exportBtn.title = 'Сохранить историю в файл (JSON)';
     exportBtn.addEventListener('click', (e) => { e.stopPropagation(); cancelAutoClose(); exportHistory(); });
     const importBtn = document.createElement('button');
     importBtn.className = 'hwh-cw-panel-btn';
     importBtn.textContent = '📂';
     importBtn.title = 'Загрузить историю из файла (JSON)';
     importBtn.addEventListener('click', (e) => { e.stopPropagation(); cancelAutoClose(); importHistory(); });
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
     while (panelLog.children.length > 200) panelLog.removeChild(panelLog.firstChild);
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
 /* ================================================================ */
 /* 🔥 v4.21: ОПРЕДЕЛЕНИЕ ЗДАНИЯ ПО НОМЕРУ СЛОТА И ЛИГЕ            */
 /* ================================================================ */
 function getSlotLocation(slotId, league) {
     slotId = parseInt(slotId);
     const isGold = (league == 1) || (slotId > 30);
     if (isGold) {
         if (slotId >= 1 && slotId <= 3) return `Ак.Магов-${slotId}`;
         if (slotId >= 4 && slotId <= 6) return `Маяк-${slotId - 3}`;
         if (slotId >= 7 && slotId <= 9) return `Казармы-${slotId - 6}`;
         if (slotId >= 10 && slotId <= 13) return `Мост-${slotId - 9}`;
         if (slotId >= 14 && slotId <= 17) return `Источник-${slotId - 13}`;
         if (slotId >= 18 && slotId <= 21) return `Литейная-${slotId - 17}`;
         if (slotId >= 22 && slotId <= 25) return `Врата-${slotId - 21}`;
         if (slotId >= 26 && slotId <= 29) return `Баст.Огня-${slotId - 25}`;
         if (slotId >= 30 && slotId <= 33) return `Баст.Льда-${slotId - 29}`;
         if (slotId >= 34 && slotId <= 40) return `Цитадель-${slotId - 33}`;
     } else {
         if (slotId >= 1 && slotId <= 2) return `Ак.Магов-${slotId}`;
         if (slotId >= 3 && slotId <= 4) return `Маяк-${slotId - 2}`;
         if (slotId >= 5 && slotId <= 6) return `Казармы-${slotId - 4}`;
         if (slotId >= 7 && slotId <= 9) return `Мост-${slotId - 6}`;
         if (slotId >= 10 && slotId <= 12) return `Источник-${slotId - 9}`;
         if (slotId >= 13 && slotId <= 15) return `Литейная-${slotId - 12}`;
         if (slotId >= 16 && slotId <= 18) return `Врата-${slotId - 15}`;
         if (slotId >= 19 && slotId <= 21) return `Баст.Огня-${slotId - 18}`;
         if (slotId >= 22 && slotId <= 24) return `Баст.Льда-${slotId - 21}`;
         if (slotId >= 25 && slotId <= 30) return `Цитадель-${slotId - 24}`;
     }
     return `Слот-${slotId}`;
 }
 /* ================================================================ */
 /* 🔥 ПЕРЕВОД ID ГЕРОЕВ/ТИТАНОВ/ПИТОМЦЕВ В ИМЕНА                  */
 /* ================================================================ */
 const heroNameCache = new Map();
 function getHeroName(heroId) {
     if (!heroId) return '?';
     const id = String(heroId);
     if (heroNameCache.has(id)) return heroNameCache.get(id);
     let name = null;
     try {
         if (typeof cheats !== 'undefined' && typeof cheats.translate === 'function') {
             const translated = cheats.translate(`LIB_HERO_NAME_${id}`);
             if (translated && !translated.startsWith('LIB_HERO_NAME_')) {
                 name = translated;
             }
         }
     } catch (e) { /* ignore */ }
     if (!name) {
         try {
             if (typeof lib !== 'undefined' && lib.data?.hero?.[id]) {
                 const heroData = lib.data.hero[id];
                 if (typeof cheats !== 'undefined' && typeof cheats.translate === 'function') {
                     const translated = cheats.translate(heroData.name || `LIB_HERO_NAME_${id}`);
                     if (translated && !translated.startsWith('LIB_HERO_NAME_')) {
                         name = translated;
                     }
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
     if (Array.isArray(team)) {
         units = team.map(h => ({ id: h.id, petId: h.petId })).filter(u => u.id);
     } else if (typeof team === 'object') {
         units = Object.values(team).map(h => ({ id: h.id, petId: h.petId })).filter(u => u.id);
     }
     if (units.length === 0) return '';
     units.sort((a, b) => a.id - b.id);
     return units.map(u => {
         const name = getHeroName(u.id);
         if (u.petId) {
             const petName = getHeroName(u.petId);
             return `${name} (${petName})`;
         }
         return name;
     }).join(', ');
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
     setPanelTitle(`🎯 Авто-цели ВГ v${GM_info.script.version}: запуск...`);
     setProgress(0);
     if (DEBUG_MODE) {
         logDebug('🔧 DEBUG_MODE включён. Расширенные логи выводятся в консоль (F12).');
     }
     try {
         if (typeof Caller === 'undefined' || typeof Caller.send === 'undefined') {
             logPanel('⚠️ HeroWarsHelper (Caller) не найден.', 'error');
             scheduleAutoClose();
             return;
         }
         /* ============================================================ */
         /* ЭТАП 1: СБОР ИСТОРИИ (всегда, независимо от активности ВГ) */
         /* ============================================================ */
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
         /* ============================================================ */
         /* ЭТАП 2: ПРОВЕРКА АКТИВНОСТИ ВГ                             */
         /* ============================================================ */
         logPanel('📡 Запрос clanWarGetInfo...', 'info');
         setProgress(32);
         const cwInfo = await Caller.send('clanWarGetInfo');
         if (!cwInfo || !cwInfo.enemySlots) {
             logPanel('⚠️ Война Гильдий не активна. База истории обновлена.', 'warn');
             checkStorageSize();
             scheduleAutoClose();
             return;
         }
         /* ============================================================ */
         /* ЭТАП 3: ОСНОВНАЯ ЛОГИКА НАЗНАЧЕНИЯ ЦЕЛЕЙ                   */
         /* ============================================================ */
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
                 const teamNames = getTeamNamesString(teamObj);
                 const slotLocation = getSlotLocation(slotId, league);
                 freeSlots.set(parseInt(slotId), {
                     slotId: parseInt(slotId), defenderId, teamString, teamType,
                     defenderName, teamNames, slotLocation
                 });
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
         if (guildMembers.length === 0) {
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
         const replayCache = new Map();
         async function getReplayInfo(replayId) {
             if (replayCache.has(replayId)) return replayCache.get(replayId);
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
                 replayCache.set(replayId, result);
                 logDebug(`📼 Реплей ${replayId}: атакующих пачек=${result.attackers.length}, защитных пачек=${result.defenders.length}`);
                 for (const d of result.defenders) {
                     logDebug(`   🛡️ [${d.teamType}] пачка=[${d.teamString}] → ${d.teamNames}`);
                 }
                 return result;
             } catch (e) {
                 logPanel(`Не удалось загрузить реплей ${replayId}`, 'warn');
                 return { attackers: [], defenders: [] };
             }
         }
         const assigned = [];
         const skipped = [];
         const totalMembers = guildMembers.length;
         for (let mi = 0; mi < guildMembers.length; mi++) {
             const member = guildMembers[mi];
             const memberName = memberNames[member.id] || member.id;
             setPanelTitle(`🎯 ${memberName} (${mi + 1}/${totalMembers}) [${member.tries} попыт.]`);
             setProgress(35 + ((mi / totalMembers) * 60));
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
                 logDebug(`📖 ${memberName}: ${memberWins.length} побед (день ${key})`);
                 for (let i = memberWins.length - 1; i >= 0; i--) {
                     if (foundCount >= member.tries) break;
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
                     const defenderFreeSlots = [...freeSlots.values()].filter(s => s.defenderId === defenderId);
                     if (defenderFreeSlots.length === 0) {
                         logDebug(`⏭️ ${memberName}: защитник ${memberNames[defenderId] || defenderId} не имеет свободных слотов`);
                         continue;
                     }
                     logDebug(`🔍 ${memberName} → ${memberNames[defenderId] || defenderId}: проверяем ${defenderFreeSlots.length} слот(а/ов)`);
                     for (const [slotId, slot] of freeSlots.entries()) {
                         if (foundCount >= member.tries) break;
                         if (slot.defenderId !== defenderId) continue;
                         logDebug(`   🔎 Слот ${slot.slotLocation} (${slot.defenderName}) [${slot.teamType}]:`);
                         logDebug(`      Текущая пачка: [${slot.teamString}]`);
                         const matchingTeam = replayInfo.defenders.find(
                             pastTeam => pastTeam.teamType === slot.teamType && pastTeam.teamString === slot.teamString
                         );
                         if (matchingTeam) {
                             logDebug(`      ✅ СОВПАДЕНИЕ с пачкой из реплея [${matchingTeam.teamType}]`);
                             logPanel(`✅ ${memberName} → ${slot.slotLocation}: ${slot.defenderName} (${foundCount + 1}/${member.tries})`, 'success');
                             const attackerNames = replayInfo.attackers.length > 0 ? replayInfo.attackers[0].teamNames : '';
                             const defenderNamesWithPets = matchingTeam.teamNames;
                             try {
                                 const result = await Caller.send({ name: 'clanWarSetTargetMark', args: { userId: member.id, slotId: slot.slotId } });
                                 const isSuccess = result === null || result === undefined || !result.error;
                                 if (isSuccess) {
                                     assigned.push({
                                         memberId: member.id, memberName, slotId: slot.slotId, defenderId,
                                         defenderName: slot.defenderName,
                                         teamNames: defenderNamesWithPets,
                                         attackerNames: attackerNames,
                                         slotLocation: slot.slotLocation
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
         setPanelTitle(`🎯 Готово: ${assigned.length} целей назначено`);
         checkStorageSize();
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
         title: 'Назначает по 1 цели на каждую попытку. Показывает названия зданий и пачки с питомцами.',
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
