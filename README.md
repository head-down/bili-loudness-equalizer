# B站视频音量均衡器 (Bilibili Loudness Equalizer)

Chrome 扩展（Manifest V3），自动标准化 B站视频音量，解决站内视频响度差异大的问题。

## 功能

- 实时音量标准化（RMS 测量 + 增益调整）
- 三段式音频处理链：Analyser → Gain → Compressor
- 四种预设模式：均衡 / 人声 / 音乐 / 游戏
- 实时响度仪表盘
- 可调参数：目标响度、压缩器阈值/比率/膝宽/起音/释放、增益范围

## 安装

1. 克隆本仓库或下载 ZIP
2. Chrome 打开 `chrome://extensions`
3. 开启「开发者模式」
4. 点击「加载已解压的扩展程序」
5. 选择 `extension/` 目录

## 使用方法

- 打开 B站视频页面，扩展自动激活
- 点击工具栏图标可开关均衡器（右键）或打开设置面板（左键）
- 设置面板可切换预设、调整参数

## 技术原理

### AudioContext 拦截

通过 Hook `AudioNode.prototype.connect` 拦截 B站播放器的 `MediaElementAudioSourceNode` 连接，插入自定义音频处理链：

```
MediaElementAudioSourceNode
  → AnalyserNode（RMS 测量）
    → GainNode（增益调整）
      → DynamicsCompressorNode（动态压缩）
        → AudioContext.destination
```

### Hook disconnect

B站播放器可能会调用 `source.disconnect()` 清空连接。通过 Hook disconnect 方法，在任何 disconnect 后重新接回 analyser，确保音量测量不中断。

### 跨世界通信

- `inject.js`（MAIN world）：音频处理引擎，通过 `<script src>` 注入
- `content.js`（ISOLATED world）：UI 层，设置管理、面板渲染
- 通过 `window.postMessage` 双向通信

## 目录结构

```
extension/
├── manifest.json    # Chrome 扩展清单 (MV3)
├── content.js       # ISOLATED world UI 层
└── inject.js        # MAIN world 音频引擎
```

## 兼容性

- Chrome 88+（Manifest V3）
- Edge 88+
- 仅 B站视频页面（`*.bilibili.com`）
