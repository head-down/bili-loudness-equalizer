// inject.js (MAIN World)
(function() {
    'use strict';

    let settings = {
        enabled: true,
        targetLufs: -18,
        compressorThreshold: -50,
        compressorRatio: 12,
        compressorKnee: 40,
        compressorAttack: 0.003,
        compressorRelease: 0.25,
        gainRange: [-12, 12]
    };

    let activeNodes = null;

    // 监听来自 Content Script 的设置更新
    window.addEventListener('message', (event) => {
        if (event.source !== window || !event.data) return;
        if (event.data.type === 'BILI_EQ_SETTINGS') {
            settings = { ...settings, ...event.data.settings };
            if (activeNodes) {
                const comp = activeNodes.compressor;
                comp.threshold.value = settings.compressorThreshold;
                comp.ratio.value = settings.compressorRatio;
                comp.knee.value = settings.compressorKnee;
                comp.attack.value = settings.compressorAttack;
                comp.release.value = settings.compressorRelease;
            }
        }
    });

    // 核心 Hook：拦截所有音频节点的连接行为
    const origConnect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function(destination, ...args) {
        // 精准拦截视频的音频源节点
        if (this instanceof MediaElementAudioSourceNode && !this.__eq_intercepted) {
            this.__eq_intercepted = true;
            const ctx = this.context;
            console.log('[LoudnessEQ MAIN] 成功拦截 B站音频流，注入均衡器链路');

            // 1. 创建分析器 (放在 Gain 之前，测量原始信号，避免泵浦效应)
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 2048;
            analyser.smoothingTimeConstant = 0.8;

            // 2. 创建增益节点
            const gain = ctx.createGain();
            gain.gain.value = 1;

            // 3. 创建压缩器
            const compressor = ctx.createDynamicsCompressor();
            compressor.threshold.value = settings.compressorThreshold;
            compressor.ratio.value = settings.compressorRatio;
            compressor.knee.value = settings.compressorKnee;
            compressor.attack.value = settings.compressorAttack;
            compressor.release.value = settings.compressorRelease;

            activeNodes = { ctx, analyser, gain, compressor };

            try {
                // 将我们的最终输出连接到 B站原本想连接的节点
                origConnect.call(compressor, destination, ...args);
            } catch(e) {
                console.error('[LoudnessEQ MAIN] 连接目标节点失败', e);
            }

            // 构建内部链路: Source -> Analyser -> Gain -> Compressor
            origConnect.call(this, analyser);
            analyser.connect(gain);
            gain.connect(compressor);

            startEngine();
            return destination;
        }
        return origConnect.call(this, destination, ...args);
    };

    function startEngine() {
        const { ctx, analyser, gain } = activeNodes;
        const dataArray = new Float32Array(analyser.fftSize);
        let lastRMS = 0;

        function update() {
            if (!settings.enabled) {
                gain.gain.setTargetAtTime(1.0, ctx.currentTime, 0.1);
                requestAnimationFrame(update);
                return;
            }

            analyser.getFloatTimeDomainData(dataArray);
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) sum += dataArray[i] * dataArray[i];
            const rms = Math.sqrt(sum / dataArray.length);
            
            // 节流发送数据给 UI (约 10fps)
            if (Math.abs(rms - lastRMS) > 0.001 || rms < 1e-10) {
                window.postMessage({ type: 'BILI_EQ_METER', rms }, '*');
                lastRMS = rms;
            }

            if (rms > 1e-10) {
                const rmsDB = 20 * Math.log10(rms);
                let gainDB = settings.targetLufs - rmsDB;
                gainDB = Math.max(settings.gainRange[0], Math.min(settings.gainRange[1], gainDB));
                const gainLinear = Math.pow(10, gainDB / 20);
                
                // 平滑过渡，避免爆音
                gain.gain.setTargetAtTime(gainLinear, ctx.currentTime, 0.2);
            }
            requestAnimationFrame(update);
        }
        requestAnimationFrame(update);
    }
})();