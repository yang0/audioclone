/**
 * AudioClone 引擎
 * 负责调用 Python TTS 脚本进行批量配音
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ora from 'ora';

export class AudioCloneEngine {
  constructor(options = {}) {
    this.modelPath = options.modelPath || 'G:/comfyui/models/omnivoice/OmniVoice-bf16';
    this.device = options.device || 'cuda';
    this.pythonEnv = options.pythonEnv || 'python';
    this.outputDir = options.outputDir || 'output_dubbed';
    
    // Python 脚本路径（兼容 npm 全局安装和本地运行）
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    this.pythonScript = path.resolve(__dirname, '..', 'python', 'tts_engine.py');
  }

  async run(params) {
    const { subtitles, audioFiles, steps, guidanceScale, speed, temperature } = params;

    // 创建输出目录
    fs.mkdirSync(this.outputDir, { recursive: true });

    // 准备批量任务 JSON
    const batchFile = path.join(this.outputDir, '.batch.json');
    const tasks = subtitles.map((sub, i) => ({
      text: sub.text,
      reference_audio: audioFiles[i],
      output: path.join(this.outputDir, `${String(i + 1).padStart(4, '0')}.wav`),
      index: sub.index,
    }));

    fs.writeFileSync(batchFile, JSON.stringify(tasks, null, 2));

    // 调用 Python TTS 引擎
    const spinner = ora('🔄  正在合成音频...').start();
    
    // 优先使用 ComfyUI 的虚拟环境（omnivoice 0.1.3，工作正常）
    const comfyVenv = path.join('G:', 'comfyui', '.venv', 'Scripts', 'python.exe');
    const venvPython = path.join('E:', 'projectHome', 'videodubbing', '.venv', 'Scripts', 'python.exe');
    const pythonToUse = fs.existsSync(comfyVenv) ? comfyVenv : (fs.existsSync(venvPython) ? venvPython : this.pythonEnv);
    
    try {
      await this._runPythonTTS({
        batchFile,
        steps,
        guidanceScale,
        speed,
        temperature,
        pythonEnv: pythonToUse,
      }, (msg) => {
        spinner.text = `🔄  ${msg}`;
      });
      
      spinner.succeed('音频合成完成');
    } catch (err) {
      spinner.fail(`音频合成失败: ${err.message}`);
      throw err;
    } finally {
      // 清理临时文件
      if (fs.existsSync(batchFile)) {
        fs.unlinkSync(batchFile);
      }
    }

    // 验证输出
    const outputFiles = tasks.map(t => t.output);
    const allExist = outputFiles.every(f => fs.existsSync(f));
    if (!allExist) {
      const missing = outputFiles.filter(f => !fs.existsSync(f));
      throw new Error(`部分输出文件未生成: ${missing.join(', ')}`);
    }

    return outputFiles;
  }

  _runPythonTTS(params, onProgress) {
    return new Promise((resolve, reject) => {
      const args = [
        this.pythonScript,
        '--batch-file', params.batchFile,
        '--model-path', this.modelPath,
        '--device', this.device,
        '--steps', String(params.steps),
        '--guidance-scale', String(params.guidanceScale),
        '--speed', String(params.speed),
        '--temperature', String(params.temperature),
      ];

      const pythonEnv = params.pythonEnv || this.pythonEnv;
      // 正确激活虚拟环境
      const venvPath = path.dirname(path.dirname(pythonEnv)); // G:/comfyui/.venv
      const newEnv = {
        ...process.env,
        VIRTUAL_ENV: venvPath,
      };
      // 不要设置 PYTHONHOME，让 venv 的 python.exe 自动推断
      delete newEnv.PYTHONHOME;
      
      // 确保 PATH 中包含 venv 的 Scripts 目录
      const scriptsPath = path.dirname(pythonEnv); // G:/comfyui/.venv/Scripts
      if (!newEnv.PATH || !newEnv.PATH.includes(scriptsPath)) {
        newEnv.PATH = scriptsPath + path.delimiter + (newEnv.PATH || '');
      }
      
      const proc = spawn(pythonEnv, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: newEnv,
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
        const lines = data.toString().trim().split('\n');
        const lastLine = lines[lines.length - 1];
        if (lastLine && onProgress) {
          onProgress(lastLine.trim());
        }
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Python 进程退出码 ${code}: ${stderr || stdout}`));
        } else {
          resolve(stdout);
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`无法启动 Python: ${err.message}`));
      });
    });
  }
}
