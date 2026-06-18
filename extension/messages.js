// messages.js — 跨世界消息契约（单点真源）
// 注入到 MAIN world，供 inject.js 使用
// content.js（ISOLATED world）侧复刻匹配的常量
;(function() {
    'use strict';

    const TYPES = /** @type {const} */ ({
        SETTINGS: 'BILI_EQ_SETTINGS',
        METER:    'BILI_EQ_METER',
    });

    const DEFAULTS = {
        enabled:    true,
        targetLufs: -18,
        gainRange:  [-12, 12],
        preset:     'balanced',
    };

    /**
     * 校验并补全 Settings 消息体（content → inject）
     * 缺失字段回退到 DEFAULTS，类型错误用默认值替换
     */
    function normalizeSettings(data) {
        if (!data || typeof data !== 'object') return { ...DEFAULTS };
        return {
            enabled:    typeof data.enabled    === 'boolean' ? data.enabled    : DEFAULTS.enabled,
            targetLufs: typeof data.targetLufs === 'number'  ? data.targetLufs : DEFAULTS.targetLufs,
            gainRange:  Array.isArray(data.gainRange) && data.gainRange.length === 2
                            ? data.gainRange : DEFAULTS.gainRange,
            preset:     typeof data.preset     === 'string'  ? data.preset     : DEFAULTS.preset,
        };
    }

    /**
     * 校验 Meter 消息体（inject → content）
     * 字段缺失或类型不符返回 null
     */
    function validateMeter(data) {
        if (!data || typeof data !== 'object') return null;
        if (typeof data.lufs !== 'number' || typeof data.gainDB !== 'number') return null;
        return { lufs: data.lufs, gainDB: data.gainDB };
    }

    /**
     * 构造标准 Settings 消息
     */
    function createSettingsMessage(settings) {
        return {
            type: TYPES.SETTINGS,
            settings: normalizeSettings(settings),
        };
    }

    /**
     * 构造标准 Meter 消息
     */
    function createMeterMessage(lufs, gainDB) {
        return {
            type: TYPES.METER,
            lufs,
            gainDB,
        };
    }

    window.__LOUDNESS_EQ__ = {
        TYPES,
        DEFAULTS,
        normalizeSettings,
        validateMeter,
        createSettingsMessage,
        createMeterMessage,
    };
})();
