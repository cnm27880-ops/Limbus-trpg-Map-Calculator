/**
 * Limbus Command - PanelDock（右緣磁鐵收納邊條）
 *
 * 把浮動面板拖到畫面右緣（磁鐵區）放開，即收納成邊條上的一個圖標；
 * 點圖標還原面板。邊條平時縮成右緣一條不明顯的細邊，
 * 滑鼠移過去自動外滑（行動裝置：點擊細邊展開），移開後自動收合。
 *
 * 與 makeFloatingPanel（st-skill-hud.js）配合：
 *   makeFloatingPanel({ ..., dock: { icon: '👹', title: 'BOSS 設定' } })
 * 拖曳結束落在磁鐵區時自動呼叫 PanelDock.dock()。
 *
 * 收納狀態為 session 內暫存（不寫入 localStorage）：動態建立的面板
 * （如 BOSS 設定）跨頁面重整後不存在，持久化反而會留下無效圖標。
 */

const PanelDock = (function () {
    let bar = null;
    let collapseTimer = null;
    const items = new Map(); // panelId -> { btn, onRestore }

    function ensureBar() {
        if (bar) return bar;
        bar = document.createElement('div');
        bar.id = 'panel-dock';
        bar.className = 'panel-dock empty';
        bar.innerHTML = '<div class="panel-dock-grip">⋮</div><div class="panel-dock-items"></div>';
        document.body.appendChild(bar);

        // 滑鼠移入外滑、移開延遲收合；行動裝置以點擊細邊展開、點空白處收合
        bar.addEventListener('pointerenter', expand);
        bar.addEventListener('pointerleave', scheduleCollapse);
        bar.addEventListener('click', (e) => {
            if (!bar.classList.contains('expanded')) {
                expand();
                e.stopPropagation();
            }
        });
        document.addEventListener('pointerdown', (e) => {
            if (bar && !bar.contains(e.target)) collapse();
        });
        return bar;
    }

    function expand() {
        clearTimeout(collapseTimer);
        ensureBar().classList.add('expanded');
    }
    function collapse() {
        if (bar) bar.classList.remove('expanded');
    }
    function scheduleCollapse() {
        clearTimeout(collapseTimer);
        collapseTimer = setTimeout(collapse, 350);
    }
    function refresh() {
        if (bar) bar.classList.toggle('empty', items.size === 0);
    }

    /**
     * 收納面板：隱藏面板並在邊條加入圖標。
     * 取出方式為「按住圖標往外拖」：拖出邊條即還原面板並跟著指標走，放開落定。
     * @param {string} panelId
     * @param {{icon?:string, title?:string, onRestore?:Function,
     *          onDragOut?:Function, onDragOutEnd?:Function}} opts
     *   onRestore()            程式化還原（快捷球重開等）時把面板拉回可視範圍
     *   onDragOut(x, y)        拖出過程中把面板定位到指標下方（由 makeFloatingPanel 提供）
     *   onDragOutEnd()         拖出放開後夾限位置並存檔
     */
    function dock(panelId, opts) {
        const panel = document.getElementById(panelId);
        if (!panel || items.has(panelId)) return false;
        const o = opts || {};
        ensureBar();

        panel.classList.add('dock-hidden');

        const btn = document.createElement('button');
        btn.className = 'panel-dock-icon';
        btn.title = `${o.title || panelId}（按住拖出以取出面板）`;
        btn.textContent = o.icon || '📋';
        btn.addEventListener('pointerdown', (e) => startIconDrag(e, panelId));
        bar.querySelector('.panel-dock-items').appendChild(btn);
        items.set(panelId, { btn, onRestore: o.onRestore, onDragOut: o.onDragOut, onDragOutEnd: o.onDragOutEnd });
        refresh();

        // 短暫外滑讓使用者看到收納結果，再自動收合
        expand();
        scheduleCollapse();
        if (typeof showToast === 'function') showToast(`已收納「${o.title || '面板'}」，按住圖標拖出即可取回`);
        return true;
    }

    /**
     * 圖標拖出還原：按住圖標移動超過門檻 → 立即還原面板並讓面板跟著指標，
     * 放開時夾限位置存檔。原地點一下（沒拖動）不還原，只提示操作方式。
     */
    function startIconDrag(e, panelId) {
        const it = items.get(panelId);
        if (!it) return;
        e.preventDefault();
        e.stopPropagation();
        const startX = e.clientX, startY = e.clientY;
        const THRESHOLD = 10;
        let draggingOut = false;

        function onMove(ev) {
            if (!draggingOut) {
                if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < THRESHOLD) return;
                draggingOut = true;
                // 取出面板：移除圖標、解除隱藏，改由指標拖行
                items.delete(panelId);
                it.btn.remove();
                refresh();
                collapse();
                const panel = document.getElementById(panelId);
                if (panel) {
                    panel.classList.remove('dock-hidden');
                    if (typeof WindowManager !== 'undefined') WindowManager.bringToFront(panel);
                }
            }
            if (typeof it.onDragOut === 'function') it.onDragOut(ev.clientX, ev.clientY);
        }
        function onUp() {
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
            document.removeEventListener('pointercancel', onUp);
            if (draggingOut) {
                if (typeof it.onDragOutEnd === 'function') it.onDragOutEnd();
            } else if (typeof showToast === 'function') {
                showToast('按住圖標往地圖方向拖出，即可取回面板');
            }
        }
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
        document.addEventListener('pointercancel', onUp);
    }

    /** 點圖標還原面板（面板已不存在時僅清掉圖標） */
    function restore(panelId) {
        const it = items.get(panelId);
        if (!it) return;
        items.delete(panelId);
        it.btn.remove();
        refresh();
        collapse();

        const panel = document.getElementById(panelId);
        if (!panel) return; // 面板已被程式移除（如 BOSS 設定已儲存關閉）
        panel.classList.remove('dock-hidden');
        if (typeof it.onRestore === 'function') it.onRestore();
        if (typeof WindowManager !== 'undefined') WindowManager.bringToFront(panel);
    }

    /** 面板被程式關閉／移除時，清掉殘留圖標（未收納則為 no-op） */
    function remove(panelId) {
        const it = items.get(panelId);
        if (!it) return;
        items.delete(panelId);
        it.btn.remove();
        refresh();
    }

    function isDocked(panelId) {
        return items.has(panelId);
    }

    /** 拖曳中進出磁鐵區的即時提示（邊條外滑並加高亮） */
    function setHint(on) {
        const b = ensureBar();
        b.classList.toggle('drop-hint', !!on);
        if (on) expand();
        else scheduleCollapse();
    }

    return { dock, restore, remove, isDocked, setHint };
})();

window.PanelDock = PanelDock;

console.log('右緣磁鐵收納邊條已載入');
