// inject.js (MAIN World)
(function() {
    'use strict';

    // 从自身 script src 推导 worklet URL（MAIN world 无法访问 chrome.runtime）
    const WORKLET_URL = (() => {
        const src = document.currentScript && document.currentScript.src;
        if (src) return src.replace(/inject\.js$/, 'worklet.js');
        return null;
    })();

    // 消息契约（由 messages.js 注入到 MAIN world）
    const EQ = window.__LOUDNESS_EQ__;
    if (!EQ) console.error('[LoudnessEQ] messages.js 未加载，消息契约不可用');

    let settings = { ...(EQ ? EQ.DEFAULTS : { enabled: true, targetLufs: -18, gainRange: [-12, 12] }) };

    let activeNodes = null;

    // ---- worklet 预加载与升级 ----

    const workletLoadState = new WeakMap(); // ctx -> { status: 'loading'|'loaded'|'failed' }
    const pendingUpgrades  = new Map();      // ctx -> { source, fallbackNodes, destination }

    async function preloadWorklet(ctx) {
        if (workletLoadState.has(ctx)) return;
        const state = { status: 'loading' };
        workletLoadState.set(ctx, state);

        try {
            await ctx.audioWorklet.addModule(WORKLET_URL);
            // 让出事件循环，等 AudioWorkletGlobalScope 完全初始化
            await new Promise(r => setTimeout(r, 0));
            state.status = 'loaded';

            // 如果有等待升级的链路，执行升级
            const upgrade = pendingUpgrades.get(ctx);
            if (upgrade) {
                upgradeToFullChain(ctx, upgrade.source, upgrade.fallbackNodes, upgrade.destination);
                pendingUpgrades.delete(ctx);
            }
        } catch (e) {
            console.warn('[LoudnessEQ] worklet 加载失败:', e.message);
            state.status = 'failed';
        }
    }

    function createWorkletNode(ctx) {
        return new AudioWorkletNode(ctx, 'loudness-processor', {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            processorOptions: { capacity: 10, interval: 0.1 }
        });
    }

    // ---- 链路工厂 ----

    function createFallbackChain(ctx, destination) {
        const gain = ctx.createGain();
        gain.gain.value = 1;
        const limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = -1.0;
        limiter.ratio.value = 20;
        limiter.knee.value = 0;
        limiter.attack.value = 0.001;
        limiter.release.value = 0.1;
        gain.connect(limiter);
        limiter.connect(destination);
        return { gain, limiter };
    }

    function createFullChain(ctx, destination) {
        const workletNode = createWorkletNode(ctx);
        const gain = ctx.createGain();
        gain.gain.value = 1;
        const limiter = ctx.createDynamicsCompressor();
        limiter.threshold.value = -1.0;
        limiter.ratio.value = 20;
        limiter.knee.value = 0;
        limiter.attack.value = 0.001;
        limiter.release.value = 0.1;

        workletNode.connect(gain);
        gain.connect(limiter);
        limiter.connect(destination);

        // LUFS 驱动的 AGC
        let meterLogCount = 0;
        workletNode.port.onmessage = (e) => {
            if (meterLogCount < 3) {
                console.log('[LoudnessEQ] worklet 消息:', JSON.stringify(e.data));
                meterLogCount++;
            }
            if (!settings.enabled) {
                gain.gain.setTargetAtTime(1.0, ctx.currentTime, 0.1);
                return;
            }
            const measurements = e.data.currentMeasurements;
            if (!measurements || !measurements.length) return;
            const m = measurements[0];
            const momentaryLufs = m?.momentaryLoudness;
            if (momentaryLufs != null && isFinite(momentaryLufs) && momentaryLufs > -70) {
                let gainDB = settings.targetLufs - momentaryLufs;
                gainDB = Math.max(settings.gainRange[0], Math.min(settings.gainRange[1], gainDB));
                const gainLinear = Math.pow(10, gainDB / 20);
                gain.gain.linearRampToValueAtTime(gainLinear, ctx.currentTime + 0.2);
                window.postMessage(EQ.createMeterMessage(momentaryLufs, gainDB), '*');
            }
        };

        return { workletNode, gain, limiter };
    }

    function upgradeToFullChain(ctx, source, fallbackNodes, destination) {
        try {
            // 断开旁路链路
            try { source.disconnect(fallbackNodes.gain); } catch(e) {}
            try { fallbackNodes.gain.disconnect(); } catch(e) {}
            try { fallbackNodes.limiter.disconnect(); } catch(e) {}

            const full = createFullChain(ctx, destination);
            source.connect(full.workletNode);
            activeNodes = { ctx, ...full, source, destination };
            setupLifecycle(ctx, full.workletNode);
        } catch (e) {
            console.error('[LoudnessEQ] 升级失败，回退到旁路:', e.message);
            // 重建旁路连接
            try { source.connect(fallbackNodes.gain); } catch(e2) {}
        }
    }

    // ---- 错误恢复与生命周期 ----

    let rebuildTimer = null;

    function teardownChain() {
        const n = activeNodes;
        if (!n) return;
        try { n.source?.disconnect(); } catch(e) {}
        try { n.workletNode?.disconnect(); } catch(e) {}
        try { n.gain?.disconnect(); } catch(e) {}
        try { n.limiter?.disconnect(); } catch(e) {}
    }

    function rebuildChain() {
        const n = activeNodes;
        if (!n || !n.source || !n.destination) return;
        const ctx = n.ctx, source = n.source, dest = n.destination;

        teardownChain();

        try {
            const state = workletLoadState.get(ctx);
            if (state && state.status === 'loaded') {
                const full = createFullChain(ctx, dest);
                source.connect(full.workletNode);
                activeNodes = { ctx, ...full, source, destination: dest };
                setupLifecycle(ctx, full.workletNode);
            } else {
                const fb = createFallbackChain(ctx, dest);
                source.connect(fb.gain);
                activeNodes = { ctx, ...fb, source, destination: dest };
            }
        } catch (e) {
            console.error('[LoudnessEQ] 链路重建失败:', e);
            try { source.connect(dest); } catch(e2) {}
            activeNodes = null;
        }
    }

    function requestRebuild() {
        if (rebuildTimer) return;
        rebuildTimer = setTimeout(() => {
            rebuildTimer = null;
            rebuildChain();
        }, 500);
    }

    function setupLifecycle(ctx, workletNode) {
        let wasSuspended = false;
        ctx.onstatechange = () => {
            if (ctx.state === 'suspended') {
                wasSuspended = true;
            } else if (ctx.state === 'running' && wasSuspended) {
                wasSuspended = false;
                if (workletNode) {
                    try {
                        workletNode.port.postMessage({ type: 'ping' });
                    } catch (e) {
                        console.warn('[LoudnessEQ] context 恢复后 port 不可用，触发重建');
                        requestRebuild();
                    }
                }
            } else if (ctx.state === 'closed') {
                console.log('[LoudnessEQ] context 已关闭');
                pendingUpgrades.delete(ctx);
                if (rebuildTimer) { clearTimeout(rebuildTimer); rebuildTimer = null; }
            }
        };

        if (workletNode) {
            workletNode.onprocessorerror = (e) => {
                console.error('[LoudnessEQ] worklet processor 错误:', e);
                requestRebuild();
            };
        }
    }

    // ---- 设置同步 ----

    window.addEventListener('message', (event) => {
        if (event.source !== window || !event.data || !EQ) return;
        if (event.data.type === EQ.TYPES.SETTINGS) {
            settings = EQ.normalizeSettings(event.data.settings);
        }
    });

    // ---- 核心 Hook：同步 connect ----

    const origConnect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function(destination, ...args) {
        if (this instanceof MediaElementAudioSourceNode && !this.__eq_intercepted) {
            this.__eq_intercepted = true;
            const ctx = this.context;

            try {
                // 触发 worklet 预加载（异步，不阻塞 connect 返回）
                if (WORKLET_URL && !workletLoadState.has(ctx)) {
                    preloadWorklet(ctx);
                }

                const state = workletLoadState.get(ctx);

                if (state && state.status === 'loaded') {
                    // worklet 已就绪 → 完整链路
                    const full = createFullChain(ctx, destination);
                    activeNodes = { ctx, ...full, source: this, destination };
                    origConnect.call(this, full.workletNode);
                    setupLifecycle(ctx, full.workletNode);
                } else {
                    // worklet 未就绪 → 旁路链路，等加载完成后自动升级
                    const fb = createFallbackChain(ctx, destination);
                    activeNodes = { ctx, ...fb, source: this, destination };
                    origConnect.call(this, fb.gain);
                    pendingUpgrades.set(ctx, { source: this, fallbackNodes: fb, destination });
                }
            } catch (e) {
                console.error('[LoudnessEQ] 链路创建失败:', e);
                origConnect.call(this, destination, ...args);
            }
            return destination;
        }
        return origConnect.call(this, destination, ...args);
    };
})();
