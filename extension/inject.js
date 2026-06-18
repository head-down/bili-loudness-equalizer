// inject.js (MAIN World) — 注入页面主世界，拦截 B站音频流
(function() {
    'use strict';

    let settings = {
        enabled: true,
        targetLufs: -18,
        compressorThreshold: -50, compressorRatio: 12, compressorKnee: 40,
        compressorAttack: 0.003, compressorRelease: 0.25,
        gainRange: [-12, 12]
    };

    let activeNodes = null;

    // 接收 Content Script 设置更新
    window.addEventListener('message', (event) => {
        if (!event.data) return;
        if (event.data.type === 'BILI_EQ_SETTINGS') {
            settings = { ...settings, ...event.data.settings };
            if (activeNodes) {
                const c = activeNodes.compressor;
                c.threshold.value = settings.compressorThreshold;
                c.ratio.value = settings.compressorRatio;
                c.knee.value = settings.compressorKnee;
                c.attack.value = settings.compressorAttack;
                c.release.value = settings.compressorRelease;
            }
        }
    });

    // Hook AudioNode.connect：拦截视频源节点的连接
    const origConnect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function(destination, ...args) {
        if (this instanceof MediaElementAudioSourceNode && !this.__eq_intercepted) {
            this.__eq_intercepted = true;
            const ctx = this.context;

            const analyser = ctx.createAnalyser();
            analyser.fftSize = 2048;
            analyser.smoothingTimeConstant = 0.8;

            const gain = ctx.createGain();
            gain.gain.value = 1;

            const compressor = ctx.createDynamicsCompressor();
            compressor.threshold.value = settings.compressorThreshold;
            compressor.ratio.value = settings.compressorRatio;
            compressor.knee.value = settings.compressorKnee;
            compressor.attack.value = settings.compressorAttack;
            compressor.release.value = settings.compressorRelease;

            activeNodes = { ctx, analyser, gain, compressor };

            // Hook disconnect：B站可能 disconnect source 后重连，需保持 analyser 不断
            const origSrcDisconnect = this.disconnect.bind(this);
            this.disconnect = function() {
                origSrcDisconnect(...arguments);
                if (activeNodes && activeNodes.analyser) {
                    try { origSrcDisconnect.call(this, activeNodes.analyser); } catch {}
                    try { origConnect.call(this, activeNodes.analyser); } catch {}
                }
            };

            // 压缩器直连扬声器
            try { origConnect.call(compressor, ctx.destination); } catch(e) {}
            // 内部链：Source → Analyser → Gain → Compressor
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
        let lastRMS = 0, frameCount = 0;

        function update() {
            try {
                if (!settings.enabled) {
                    gain.gain.setTargetAtTime(1.0, ctx.currentTime, 0.1);
                    requestAnimationFrame(update);
                    return;
                }

                analyser.getFloatTimeDomainData(dataArray);
                let sum = 0;
                for (let i = 0; i < dataArray.length; i++) sum += dataArray[i] * dataArray[i];
                const rms = Math.sqrt(sum / dataArray.length);

                // 约 10fps 发送给 UI
                if (++frameCount % 6 === 0 && (Math.abs(rms - lastRMS) > 0.001 || rms < 1e-10)) {
                    window.postMessage({ type: 'BILI_EQ_METER', rms }, '*');
                    lastRMS = rms;
                }

                if (rms > 1e-10) {
                    const rmsDB = 20 * Math.log10(rms);
                    let gainDB = settings.targetLufs - rmsDB;
                    gainDB = Math.max(settings.gainRange[0], Math.min(settings.gainRange[1], gainDB));
                    gain.gain.setTargetAtTime(Math.pow(10, gainDB / 20), ctx.currentTime, 0.2);
                }
                requestAnimationFrame(update);
            } catch(e) {
                requestAnimationFrame(update);
            }
        }
        requestAnimationFrame(update);
    }
})();
