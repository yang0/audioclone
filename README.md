# audioclone

基于 **OmniVoice** 的音频克隆配音 CLI 工具。输入已按字幕切分的原音频片段和字幕文件，批量输出配音音频。

## 功能

- **批量配音**：根据字幕文件（.srt）和已切分的原音频片段，逐条生成克隆配音
- **自动匹配**：字幕序号自动对应音频片段编号（0001.wav → 字幕 #1）
- **OmniVoice 全参数支持**：步数、引导强度、语速、温度均可调节
- **Node.js CLI + Python 后端**：前端负责流程编排，后端负责 GPU 推理
- **内置验证**：一键验证字幕与音频片段的匹配完整性

## 快速开始

### 1. 安装

```bash
# 全局安装（需要 Node.js >= 18）
npm install -g audioclone
```

### 2. 环境依赖

需要 **ComfyUI 虚拟环境**中的 Python（已安装 OmniVoice、torch 等）：

```bash
# 默认自动检测 ComfyUI 虚拟环境
# 路径：G:/comfyui/.venv/Scripts/python.exe
```

或手动指定：

```bash
audioclone dub -s subs.srt -a audio_dir -o out --python-env /path/to/python
```

### 3. 使用

```bash
# 执行配音
audioclone dub -s test/test2_en.srt -a test/output -o output_dubbed

# 验证输入文件
audioclone verify -s test/test2_en.srt -a test/output
```

## 命令参数

### `audioclone dub` — 执行配音

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `-s, --subtitles` | **必填** | 字幕文件路径 (.srt) |
| `-a, --audio-dir` | **必填** | 参考音频片段目录 |
| `-o, --output` | `output_dubbed` | 输出目录 |
| `--model-path` | `G:/comfyui/models/omnivoice/OmniVoice-bf16` | OmniVoice 模型路径 |
| `--device` | `cuda` | 计算设备 (`cuda`/`cpu`) |
| `--steps` | `32` | 推理步数（4-64） |
| `--guidance-scale` | `2.0` | 引导强度（0-10） |
| `--speed` | `1.0` | 语速（0.5-2.0） |
| `--temperature` | `5.0` | mask-position 温度（0-20） |
| `--t-shift` | `0.1` | 时间步偏移 |
| `--python-env` | 自动检测 | Python 解释器路径 |

### `audioclone verify` — 验证输入文件

```bash
audioclone verify -s test/test2_en.srt -a test/output
```

验证字幕条目数是否与音频片段数量一致。

## 输入文件格式

### 字幕文件 (.srt)

支持含说话人标记的标准 SRT 格式：

```
1
00:00:01,790 --> 00:00:03,950
[Speaker 1] Welcome to the podcast.

2
00:00:07,140 --> 00:00:08,820
[Speaker 2] Hello everyone.
```

### 音频片段

按字幕顺序编号，格式：

```
test/output/
  0001.wav   ← 对应字幕 #1
  0002.wav   ← 对应字幕 #2
  ...
```

要求：
- 文件名必须是 4 位数字编号（0001, 0002, ...）
- 格式为 WAV（16-bit PCM）
- 数量必须与字幕条目完全一致

## 技术架构

```
字幕文件 (.srt)    原音频片段 (0001.wav, ...)
        ↓                    ↓
        └────────┬───────────┘
                 ↓
         Node.js CLI
    （参数解析、流程编排、进度显示）
                 ↓
         Python TTS Engine
    （OmniVoice 语音克隆推理）
                 ↓
         输出配音音频 (output/0001.wav, ...)
```

## 已知问题

### ⚠️ 必须运行 `audioclone` 的系统用户需要 Node.js

在 Windows 上，如果通过 `npm install -g audioclone` 全局安装，命令行中可能出现编码问题。建议在 Node.js >= 18 环境下使用。

## 开发

```bash
git clone <repo>
cd audioclone
npm install
```

本地测试：

```bash
node bin/audioclone.js dub -s test/test2_en.srt -a test/output -o output_dubbed
```

## License

MIT
