// inject.js (MAIN World)
(function() {
    'use strict';

    // 从自身 script src 推导 worklet URL（MAIN world 无法访问 chrome.runtime）
    const WORKLET_URL = (() => {
        const src = document.currentScript && document.currentScript.src;
        console.log('[LoudnessEQ MAIN] currentScript.src:', src);
        if (src) return src.replace(/inject\.js$/, 'worklet.js');
        console.error('[LoudnessEQ MAIN] 无法获取 currentScript.src');
        return null;
    })();
    console.log('[LoudnessEQ MAIN] WORKLET_URL:', WORKLET_URL);

    let settings = {
        enabled: true,
        targetLufs: -18, // 目标 LUFS
        gainRange: [-12, 12] // 允许的最大增益调整范围
    };

    let activeNodes = null;
    const loadedContexts = new WeakMap();  // ctx -> boolean，每个 AudioContext 需单独 addModule

    async function ensureWorklet(ctx) {
        if (loadedContexts.get(ctx) === true) return;
        console.log('[LoudnessEQ MAIN] 加载 Worklet 到当前 ctx:', WORKLET_URL);
        await ctx.audioWorklet.addModule(WORKLET_URL);
        // 关键：让出事件循环，等 AudioWorkletGlobalScope 完全初始化
        // addModule resolve 只表示加载请求成功，scope 就绪是异步的
        await new Promise(r => setTimeout(r, 0));
        loadedContexts.set(ctx, true);
        console.log('[LoudnessEQ MAIN] Worklet 加载成功，scope 就绪');
    }

    function createWorkletNode(ctx) {
        return new AudioWorkletNode(ctx, 'loudness-processor', {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            processorOptions: { capacity: 10, interval: 0.1 } // 每 100ms 汇报一次
        });
    }

    window.addEventListener('message', (event) => {
        if (event.source !== window || !event.data) return;
        if (event.data.type === 'BILI_EQ_SETTINGS') {
            settings = { ...settings, ...event.data.settings };
        }
    });

    const origConnect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = async function(destination, ...args) {
        if (this instanceof MediaElementAudioSourceNode && !this.__eq_intercepted) {
            this.__eq_intercepted = true;
            const ctx = this.context;
            console.log('[LoudnessEQ MAIN] 拦截 B站音频流，ctx:', ctx, 'samplingRate:', ctx.sampleRate);

            try {
                // 1. 动态加载真正的 EBU R128 LUFS Worklet（每个 ctx 必须单独加载）
                if (WORKLET_URL) {
                    await ensureWorklet(ctx);
                }

                // 2. 创建 LUFS 测量节点 (400ms 窗口，适合实时 AGC)
                let workletNode;
                try {
                    workletNode = createWorkletNode(ctx);
                } catch (nodeErr) {
                    // scope 失效（ctx 被 close/suspend 后重开），清除缓存重新 addModule
                    console.warn('[LoudnessEQ MAIN] AudioWorkletNode 构造失败，重新加载 worklet:', nodeErr.message);
                    loadedContexts.set(ctx, false);
                    await ensureWorklet(ctx);
                    workletNode = createWorkletNode(ctx);
                }

                // 3. 创建自动增益节点
                const gain = ctx.createGain();
                gain.gain.value = 1;

                // 4. 创建峰值限幅器 (Limiter) - 替代原有的暴力压缩器
                // 仅在音量突破 -1dB 时介入，完美保留音乐动态，防止爆音
                const limiter = ctx.createDynamicsCompressor();
                limiter.threshold.value = -1.0; 
                limiter.ratio.value = 20;       // 20:1 相当于 Limiter
                limiter.knee.value = 0;         // 硬拐点
                limiter.attack.value = 0.001;   // 极快起音
                limiter.release.value = 0.1;    // 快速释放

                activeNodes = { ctx, workletNode, gain, limiter };

                // 5. 专业链路：Source -> Worklet(测量+透传) -> Gain(AGC) -> Limiter(防削波) -> Destination
                origConnect.call(this, workletNode);
                workletNode.connect(gain);
                gain.connect(limiter);
                origConnect.call(limiter, destination, ...args);

            // 6. 监听真实 LUFS 数据并调整 Gain
            let meterLogCount = 0;
            console.log('[LoudnessEQ MAIN] 开始监听 worklet 消息...');
            workletNode.port.onmessage = (e) => {
                if (meterLogCount < 3) {
                    console.log('[LoudnessEQ MAIN] Worklet 原始消息:', JSON.stringify(e.data));
                    meterLogCount++;
                }
                if (!settings.enabled) {
                    gain.gain.setTargetAtTime(1.0, ctx.currentTime, 0.1);
                    return;
                }
                const measurements = e.data.currentMeasurements;
                if (!measurements || !measurements.length) {
                    if (meterLogCount < 5) console.log('[LoudnessEQ MAIN] currentMeasurements 为空或不存在');
                    return;
                }
                const m = measurements[0];
                // 使用 Momentary LUFS (400ms) 进行实时响应
                const momentaryLufs = m?.momentaryLoudness;
                
                if (momentaryLufs != null && isFinite(momentaryLufs) && momentaryLufs > -70) { // 门限：剔除绝对静音段
                    let gainDB = settings.targetLufs - momentaryLufs;
                    gainDB = Math.max(settings.gainRange[0], Math.min(settings.gainRange[1], gainDB));
                    const gainLinear = Math.pow(10, gainDB / 20);
                    
                    // 使用 linearRamp 平滑过渡，彻底消除 Pumping
                    gain.gain.linearRampToValueAtTime(gainLinear, ctx.currentTime + 0.2);
                    
                    // 回传给 UI 显示真实 LUFS
                    window.postMessage({ type: 'BILI_EQ_METER', lufs: momentaryLufs, gainDB }, '*');
                }
                };

            } catch (e) {
                console.error('[LoudnessEQ MAIN] 引擎初始化失败:', e);
                origConnect.call(this, destination, ...args);
            }
            return destination;
        }
        return origConnect.call(this, destination, ...args);
    };
})();