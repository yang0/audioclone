"""
OmniVoice TTS Engine - Python 后端
完全复制 ComfyUI-OmniVoice-TTS 自定义节点的实现

关键点：
1. 必须先阻断 torchcodec，再 import torch
2. 使用 ComfyUI 虚拟环境运行（sys.path 指向 G:/comfyui/.venv）
3. 完全复制 voice_clone_node.py 的 generate() 逻辑
"""
import sys
import os
import io

# ========== 0. 强制 UTF-8 输出（Node.js spawn 默认为 GBK，会导致 UnicodeEncodeError）==========
if sys.platform == "win32":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8')
    os.environ['PYTHONIOENCODING'] = 'utf-8'

import argparse
import json
from pathlib import Path

# ========== 1. 先阻断 torchcodec（必须在任何 import 之前）==========
_tc_broken = False
if 'torchcodec' not in sys.modules:
    try:
        import torchcodec  # noqa: F401
    except Exception:
        _tc_broken = True

_tc = sys.modules.get('torchcodec')
if _tc_broken or _tc is None or getattr(_tc, '__spec__', None) is None:
    import types
    import importlib.util
    _tc_stub = types.ModuleType('torchcodec')
    _tc_stub.__path__ = []
    _tc_stub.__package__ = 'torchcodec'
    _tc_stub.__spec__ = importlib.util.spec_from_loader(
        'torchcodec', loader=None, origin='torchcodec'
    )
    for _sub in ('decoders', 'encoders', 'samplers', 'transforms', '_core'):
        _sub_mod = types.ModuleType(f'torchcodec.{_sub}')
        _sub_mod.__spec__ = importlib.util.spec_from_loader(
            f'torchcodec.{_sub}', loader=None
        )
        if _sub == 'decoders':
            class _AudioDecoder:
                pass
            _sub_mod.AudioDecoder = _AudioDecoder
        setattr(_tc_stub, _sub, _sub_mod)
        sys.modules[f'torchcodec.{_sub}'] = _sub_mod
    sys.modules['torchcodec'] = _tc_stub
    
    import importlib.metadata as _ilm
    _orig_ilm_version = _ilm.version
    def _patched_ilm_version(name):
        if name == "torchcodec":
            return "0.0.0"
        return _orig_ilm_version(name)
    _ilm.version = _patched_ilm_version

# ========== 1. 设置 ComfyUI 虚拟环境路径 ==========
# 优先使用 ComfyUI 虚拟环境的 site-packages（移到最前面，覆盖系统 Python 的包）
comfyui_site = 'G:/comfyui/.venv/Lib/site-packages'
if comfyui_site not in sys.path:
    sys.path.insert(0, comfyui_site)
else:
    # 如果已在列表中，移到最前面
    sys.path.remove(comfyui_site)
    sys.path.insert(0, comfyui_site)

import torch
import numpy as np
import soundfile as sf
import soxr

# OmniVoice 输出采样率
OMNIVOICE_SAMPLE_RATE = 24000


def load_ref_audio(audio_path: str):
    """加载参考音频 — 完全复制 ComfyUI comfy_audio_to_numpy 逻辑"""
    audio_np, sr = sf.read(audio_path)
    audio_np = audio_np.astype(np.float32)
    
    # 转为单声道
    if audio_np.ndim > 1:
        audio_np = audio_np.mean(axis=1)
    
    # 重采样到 24kHz
    if sr != OMNIVOICE_SAMPLE_RATE:
        audio_np = soxr.resample(audio_np, sr, OMNIVOICE_SAMPLE_RATE)
    
    return audio_np


class OmniVoiceTTSEngine:
    def __init__(self, model_path: str, device: str = "cuda"):
        self.model_path = model_path
        self.device = device
        self.model = None
        self._asr_pipe = None

    def load_model(self):
        if self.model is not None:
            return
        
        print(f"Loading OmniVoice model from {self.model_path}...")
        try:
            from omnivoice import OmniVoice
            
            # 解析设备（和 ComfyUI loader.py 完全一致）
            if self.device == "cuda":
                target_device = "cuda:0"
                dtype = torch.float16
            else:
                target_device = "cpu"
                dtype = torch.float32
            
            # 加载模型：torch_dtype + .to(device)
            self.model = OmniVoice.from_pretrained(
                self.model_path,
                torch_dtype=dtype,
            )
            self.model = self.model.to(target_device)
            self.model.eval()
        except ImportError as e:
            print(f"Warning: OmniVoice not found: {e}")
            self.model = None
            return
        except Exception as e:
            print(f"Warning: Failed to load model: {e}")
            import traceback
            traceback.print_exc()
            self.model = None
            return
        
        # 打印成功信息（放在 try/except 外，避免 print 异常销毁已加载的模型）
        print(f"[OK] Model loaded (device={target_device}, dtype={dtype})")

    def synthesize(self, text: str, reference_audio: str, output_path: str,
                   steps: int = 32, guidance_scale: float = 2.0,
                   speed: float = 1.0, temperature: float = 5.0,
                   t_shift: float = 0.1, ref_text: str = "") -> str:
        """
        合成音频 — 完全复制 ComfyUI voice_clone_node.py 的 generate() 逻辑
        """
        self.load_model()
        
        if self.model is None:
            print(f"Placeholder mode: {text[:50]}...")
            self._generate_placeholder(output_path, duration=len(text) * 0.1)
            return output_path

        print(f"Synthesizing: {text[:60]}...")
        
        # 加载参考音频
        ref_audio_np = load_ref_audio(reference_audio)
        ref_audio_tensor = torch.from_numpy(ref_audio_np).float()
        ref_duration = len(ref_audio_np) / OMNIVOICE_SAMPLE_RATE
        
        if ref_duration < 1:
            print(f"  WARNING: Reference audio only {ref_duration:.1f}s — recommend 3-15s")
        elif ref_duration > 30:
            print(f"  WARNING: Reference audio is {ref_duration:.1f}s — longer than recommended 15s")
        
        # 构建 gen_kwargs（完全复制 voice_clone_node.py）
        gen_kwargs = {
            "text": text,
            "num_step": steps,
            "guidance_scale": guidance_scale,
            "t_shift": t_shift,
            "speed": speed,
            "ref_audio": (ref_audio_tensor, OMNIVOICE_SAMPLE_RATE),
            "position_temperature": temperature,
            "class_temperature": 0.0,
            "layer_penalty_factor": 5.0,
            "denoise": True,
            "preprocess_prompt": True,
            "postprocess_output": True,
        }
        
        # 如果提供了 ref_text，加入参数
        if ref_text and ref_text.strip():
            gen_kwargs["ref_text"] = ref_text.strip()
            print(f"  Using provided ref_text: {ref_text[:50]}...")
        
        # 生成
        with torch.no_grad():
            audio_list = self.model.generate(**gen_kwargs)
        
        # 后处理
        audio_np = audio_list[0].squeeze(0).cpu().numpy()
        
        # Fade-in/out 消除片段边界爆音
        FADE_MS = 50  # 50ms 淡入淡出
        fade_len = min(int(OMNIVOICE_SAMPLE_RATE * FADE_MS / 1000), len(audio_np) // 3)
        if fade_len > 0:
            fade_in = np.linspace(0, 1, fade_len, dtype=np.float32)
            fade_out = np.linspace(1, 0, fade_len, dtype=np.float32)
            audio_np[:fade_len] *= fade_in
            audio_np[-fade_len:] *= fade_out
        
        # RMS 归一化：让所有克隆片段保持一致的响度水平
        TARGET_RMS = 0.1  # 目标RMS (-20dBFS)，适合语音
        rms = float(np.sqrt(np.mean(np.square(audio_np.astype(np.float64)))))
        if rms > 1e-6:
            gain = TARGET_RMS / rms
            audio_np = (audio_np * gain).clip(-1.0, 1.0)
        
        # 保存
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        sf.write(output_path, audio_np, OMNIVOICE_SAMPLE_RATE)
        
        print(f"  [OK] Saved: {output_path} ({len(audio_np)/OMNIVOICE_SAMPLE_RATE:.2f}s)")
        return output_path

    def _generate_placeholder(self, output_path: str, duration: float = 1.0, sr: int = 24000):
        t = np.linspace(0, duration, int(sr * duration))
        audio = 0.3 * np.sin(2 * np.pi * 440 * t)
        fade = int(0.1 * sr)
        audio[:fade] *= np.linspace(0, 1, fade)
        audio[-fade:] *= np.linspace(1, 0, fade)
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        sf.write(output_path, audio, sr)

    def batch_synthesize(self, tasks: list, **kwargs):
        total = len(tasks)
        outputs = []
        for i, task in enumerate(tasks):
            print(f"[{i+1}/{total}] Processing...")
            output = self.synthesize(
                text=task['text'],
                reference_audio=task['reference_audio'],
                output_path=task['output'],
                **kwargs
            )
            outputs.append(output)
        print(f"Batch complete: {len(outputs)} files")
        return outputs


def main():
    parser = argparse.ArgumentParser(description='OmniVoice TTS Engine')
    parser.add_argument('--batch-file', required=True, help='JSON batch task file')
    parser.add_argument('--model-path', default='G:/comfyui/models/omnivoice/OmniVoice-bf16')
    parser.add_argument('--device', default='cuda')
    parser.add_argument('--steps', type=int, default=32)
    parser.add_argument('--guidance-scale', type=float, default=2.0)
    parser.add_argument('--speed', type=float, default=1.0)
    parser.add_argument('--temperature', type=float, default=5.0)
    parser.add_argument('--t-shift', type=float, default=0.1)
    args = parser.parse_args()

    # Load tasks
    with open(args.batch_file, 'r', encoding='utf-8') as f:
        tasks = json.load(f)

    # Run
    engine = OmniVoiceTTSEngine(model_path=args.model_path, device=args.device)
    engine.batch_synthesize(
        tasks,
        steps=args.steps,
        guidance_scale=args.guidance_scale,
        speed=args.speed,
        temperature=args.temperature,
        t_shift=args.t_shift,
    )

    print("All done")


if __name__ == '__main__':
    main()
