// content.js (ISOLATED World)
(function() {
    'use strict';

    // 1. 注入底层音频脚本
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('inject.js');
    script.onload = function() { this.remove(); };
    (document.head || document.documentElement).appendChild(script);

    const DEFAULT_SETTINGS = {
        enabled: true, targetLufs: -18, preset: 'balanced', gainRange: [-12, 12]
    };

    const PRESETS = {
        balanced: { targetLufs: -18, gainRange: [-12, 12] },
        voice:    { targetLufs: -16, gainRange: [-6, 6] },
        music:    { targetLufs: -18, gainRange: [-6, 3] },
        gaming:   { targetLufs: -20, gainRange: [-24, 6] },
    };
    const PRESET_LABELS = { balanced: '均衡模式', voice: '人声增强', music: '音乐模式', gaming: '游戏模式', custom: '自定义' };

    let currentSettings = { ...DEFAULT_SETTINGS };
    let lastLufs = -100;
    let panelElement = null;

    // 2. 存储 API 替换
    function loadSettings() {
        return new Promise(resolve => {
            chrome.storage.local.get(['bili_eq_settings'], (result) => {
                resolve(result.bili_eq_settings || { ...DEFAULT_SETTINGS });
            });
        });
    }

    function saveSettings(settings) {
        currentSettings = settings;
        chrome.storage.local.set({ bili_eq_settings: settings });
        window.postMessage({ type: 'BILI_EQ_SETTINGS', settings }, '*');
    }

    // 3. 接收底层音频数据
    window.addEventListener('message', (event) => {
        if (!event.data) return;
        if (event.data.type === 'BILI_EQ_METER') {
            console.log('[LoudnessEQ CONTENT] 收到 LUFS:', event.data.lufs, 'gainDB:', event.data.gainDB);
            lastLufs = event.data.lufs;
            updateMeterDisplay();
        }
    });

    // 4. UI 样式与渲染 (与之前类似，略作精简)
    function injectStyles() {
        if (document.getElementById('bili-eq-styles')) return;
        const style = document.createElement('style');
        style.id = 'bili-eq-styles';
        style.textContent = `
            .bili-loudness-btn { color: hsla(0,0%,100%,.8); cursor: pointer; margin-right: 4px; background: rgba(0,161,214,.2); border-radius: 4px; padding: 2px 6px; border: 1px solid rgba(0,161,214,.4); display: inline-flex; align-items: center; }
            .bili-loudness-btn.active { color: #00a1d6 !important; border-color: #00a1d6; }
            .bili-loudness-panel { position: fixed; top: 80px; right: 20px; width: 300px; background: rgba(30,30,30,.95); border: 1px solid rgba(255,255,255,.1); border-radius: 8px; padding: 16px; z-index: 99999; color: #eee; font-size: 13px; box-shadow: 0 4px 24px rgba(0,0,0,.4); backdrop-filter: blur(10px); }
            .bili-loudness-panel label { display: block; margin: 10px 0 4px; color: #aaa; font-size: 12px; }
            .bili-loudness-panel select, .bili-loudness-panel input[type=range] { width: 100%; margin: 0; }
            .bili-loudness-panel .value { color: #00a1d6; float: right; font-size: 12px; }
            .bili-loudness-panel .lu-meter { text-align: center; padding: 8px; margin: 8px 0; background: rgba(0,0,0,.3); border-radius: 4px; font-family: monospace; }
            .bili-loudness-panel .lufs-value { color: #00d68f; font-size: 24px; font-weight: bold; }
        `;
        document.head.appendChild(style);
    }

    function tryAddControlBtn() {
        if (document.querySelector('.bili-loudness-btn')) return true;
        const rightControl = document.querySelector('.bpx-player-control-bottom-right, .bilibili-player-video-control-bottom-right');
        if (!rightControl) return false;
        
        const btn = document.createElement('div');
        btn.className = 'bpx-player-ctrl-btn bili-loudness-btn';
        btn.innerHTML = `<svg viewBox="0 0 22 22" width="22" height="22"><path d="M6 15V7a1 1 0 10-2 0v8a1 1 0 102 0z" fill="currentColor"/><path d="M12 18V4a1 1 0 10-2 0v14a1 1 0 102 0z" fill="currentColor"/><path d="M18 13V9a1 1 0 10-2 0v4a1 1 0 102 0z" fill="currentColor"/></svg>`;
        btn.onclick = (e) => { e.stopPropagation(); togglePanel(); };
        btn.oncontextmenu = (e) => {
            e.preventDefault();
            currentSettings.enabled = !currentSettings.enabled;
            saveSettings(currentSettings);
            updateBtnState(btn);
        };

        const anchor = rightControl.querySelector('.bpx-player-ctrl-volume, .bilibili-player-video-btn-volume');
        if (anchor) rightControl.insertBefore(btn, anchor);
        else rightControl.appendChild(btn);
        
        updateBtnState(btn);
        return true;
    }

    function updateBtnState(btn) {
        if (!btn) return;
        btn.classList.toggle('active', currentSettings.enabled);
        btn.title = '音量均衡: ' + (currentSettings.enabled ? '开' : '关');
    }

    function togglePanel() {
        if (!panelElement) {
            panelElement = document.createElement('div');
            panelElement.className = 'bili-loudness-panel';
            panelElement.innerHTML = `
                <div style="display:flex;justify-content:space-between;margin-bottom:12px">
                    <strong>音量均衡器 v2.0</strong>
                    <span style="cursor:pointer;font-size:18px" id="bili-eq-close">&times;</span>
                </div>
                <div class="lu-meter">
                    <span style="color:#aaa">当前响度</span>
                    <div class="lufs-value" id="bili-eq-lufs">-- dB</div>
                </div>
                <label>预设模式</label>
                <select id="bili-eq-preset">
                    ${Object.keys(PRESET_LABELS).map(k => `<option value="${k}">${PRESET_LABELS[k]}</option>`).join('')}
                </select>
                <label>目标响度 <span class="value" id="val-target">${currentSettings.targetLufs} LUFS</span></label>
                <input type="range" id="bili-eq-lufs-target" min="-30" max="-10" value="${currentSettings.targetLufs}" step="1">
            `;
            document.body.appendChild(panelElement);
            
            document.getElementById('bili-eq-close').onclick = () => panelElement.style.display = 'none';
            document.getElementById('bili-eq-preset').onchange = (e) => {
                const p = PRESETS[e.target.value];
                if (p) saveSettings({ ...currentSettings, ...p, preset: e.target.value });
            };
            document.getElementById('bili-eq-lufs-target').oninput = (e) => {
                document.getElementById('val-target').textContent = e.target.value + ' LUFS';
                saveSettings({ ...currentSettings, targetLufs: Number(e.target.value), preset: 'custom' });
            };
        }
        panelElement.style.display = panelElement.style.display === 'none' ? 'block' : 'none';
    }

    function updateMeterDisplay() {
        if (!panelElement || panelElement.style.display === 'none') return;
        const el = document.getElementById('bili-eq-lufs');
        if (el) {
            const value = lastLufs !== undefined && lastLufs > -70 ? lastLufs.toFixed(1) + ' LUFS' : '-- LUFS';
            el.textContent = value;
        }
    }

    // 5. 初始化与轮询
    async function init() {
        currentSettings = await loadSettings();
        window.postMessage({ type: 'BILI_EQ_SETTINGS', settings: currentSettings }, '*');
        injectStyles();

        let polls = 0;
        const timer = setInterval(() => {
            if (tryAddControlBtn() || polls++ > 20) clearInterval(timer);
        }, 1000);
    }

    if (document.head) init();
    else {
        const obs = new MutationObserver(() => {
            if (document.head) { obs.disconnect(); init(); }
        });
        obs.observe(document.documentElement, { childList: true });
    }
})();