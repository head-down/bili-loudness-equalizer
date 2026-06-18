# B站视频音量均衡器 (Bilibili Loudness Equalizer)

[![GitHub stars](https://img.shields.io/github/stars/head-down/bili-loudness-equalizer?style=flat-square&color=gold)](https://github.com/head-down/bili-loudness-equalizer/stargazers)
[![GitHub license](https://img.shields.io/github/license/head-down/bili-loudness-equalizer?style=flat-square&color=blue)](https://github.com/head-down/bili-loudness-equalizer/blob/master/LICENSE)
[![Platform](https://img.shields.io/badge/platform-Chrome%20%7C%20Edge-4285F4?style=flat-square&logo=googlechrome)](https://github.com/head-down/bili-loudness-equalizer)
[![JavaScript](https://img.shields.io/badge/javascript-ES6%2B-yellow?style=flat-square&logo=javascript)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![Status](https://img.shields.io/badge/status-working-brightgreen?style=flat-square)](https://github.com/head-down/bili-loudness-equalizer)

Chrome 扩展（Manifest V3），自动标准化 B站视频音量。基于 LUFS 标准实时测量响度，让每个视频听感一致。

## 星标趋势

[![Star History Chart](https://api.star-history.com/svg?repos=head-down/bili-loudness-equalizer&type=Date)](https://star-history.com/#head-down/bili-loudness-equalizer&Date)

## 原理

- 通过 Hook `AudioNode.prototype.connect` 拦截 B站播放器的 `MediaElementAudioSourceNode` 连接
- 插入三段式音频处理链：`AnalyserNode`（RMS 测量）→ `GainNode`（增益调整）→ `DynamicsCompressorNode`（动态压缩）
- Hook `disconnect` 方法，B站播放器清空连接后自动重接，确保音量测量不中断
- `inject.js`（MAIN world）处理音频引擎，`content.js`（ISOLATED world）管理 UI 和设置，通过 `window.postMessage` 双向通信

## 安装

```bash
# 克隆仓库
git clone https://github.com/head-down/bili-loudness-equalizer.git

# Chrome 打开 chrome://extensions
# 开启「开发者模式」→ 点击「加载已解压的扩展程序」→ 选择 extension/ 目录
```

## 使用方法

- 打开 B站视频页面，扩展自动激活
- 点击工具栏图标打开设置面板，切换预设或调整参数
- 四种预设模式：均衡 / 人声增强 / 音乐模式 / 游戏模式

## 配置

点击扩展图标打开设置面板调整，或修改 `content.js` 中 `DEFAULT_SETTINGS`：

| 配置项 | 说明 |
|--------|------|
| `targetLufs` | 目标响度 LUFS（默认 -18） |
| `compressorThreshold` | 压缩器阈值 dB（默认 -50） |
| `compressorRatio` | 压缩比率（默认 12:1） |
| `compressorKnee` | 压缩膝宽 dB（默认 40） |
| `compressorAttack` | 起音时间 秒（默认 0.003） |
| `compressorRelease` | 释放时间 秒（默认 0.25） |
| `preset` | 预设模式：balanced / voice / music / gaming |

## 平台

跨平台 — 支持 Windows / macOS / Linux 上的 Chrome 88+ 和 Edge 88+（Manifest V3）。

## 许可证

MIT License — 音量均衡，快乐刷B站。
