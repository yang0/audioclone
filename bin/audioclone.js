#!/usr/bin/env node
/**
 * audioclone - CLI entry point
 * 
 * Usage:
 *   audioclone --subtitles test/test2_en.srt --audio-dir test/output --output output_dubbed
 *   audioclone -s test/test2_en.srt -a test/output -o output_dubbed
 */

import { program } from 'commander';
import chalk from 'chalk';
import { AudioCloneEngine } from '../src/engine.js';
import { parseSRT } from '../src/srt-parser.js';
import fs from 'fs';
import path from 'path';

program
  .name('audioclone')
  .description('使用 OmniVoice 克隆音频配音')
  .version('1.0.0');

program
  .command('dub')
  .description('配音：根据字幕文件和参考音频生成克隆配音')
  .requiredOption('-s, --subtitles <path>', '字幕文件路径 (.srt)')
  .requiredOption('-a, --audio-dir <dir>', '参考音频片段目录 (包含 0001.wav, 0002.wav, ...)')
  .option('-o, --output <dir>', '输出目录', 'output_dubbed')
  .option('--model-path <path>', 'OmniVoice 模型路径', 'G:/comfyui/models/omnivoice/OmniVoice-bf16')
  .option('--device <device>', '计算设备 (cuda/cpu)', 'cuda')
  .option('--steps <n>', '推理步数', '32')
  .option('--guidance-scale <n>', '引导强度', '2.0')
  .option('--speed <n>', '语速', '1.0')
  .option('--temperature <n>', '温度', '1.0')
  .option('--python-env <path>', 'Python 解释器路径', 'python')
  .action(async (options) => {
    try {
      console.log(chalk.bold.green('🎙️  AudioClone - OmniVoice 配音引擎'));
      console.log('');

      // Validate inputs
      if (!fs.existsSync(options.subtitles)) {
        console.error(chalk.red(`❌ 字幕文件不存在: ${options.subtitles}`));
        process.exit(1);
      }
      if (!fs.existsSync(options.audioDir)) {
        console.error(chalk.red(`❌ 音频目录不存在: ${options.audioDir}`));
        process.exit(1);
      }

      // Parse SRT
      console.log(chalk.cyan('📄 解析字幕文件...'));
      const srtContent = fs.readFileSync(options.subtitles, 'utf-8');
      const subtitles = parseSRT(srtContent);
      console.log(chalk.dim(`   共 ${subtitles.length} 条字幕`));

      // Validate audio segments
      const audioFiles = subtitles.map((_, i) => {
        const num = String(i + 1).padStart(4, '0');
        return path.join(options.audioDir, `${num}.wav`);
      });
      
      const missing = audioFiles.filter(f => !fs.existsSync(f));
      if (missing.length > 0) {
        console.error(chalk.red(`❌ 缺少参考音频文件:`));
        missing.forEach(f => console.error(chalk.red(`   - ${f}`)));
        process.exit(1);
      }

      // Run engine
      const engine = new AudioCloneEngine({
        modelPath: options.modelPath,
        device: options.device,
        pythonEnv: options.pythonEnv,
        outputDir: options.output,
      });

      await engine.run({
        subtitles,
        audioFiles,
        steps: parseInt(options.steps),
        guidanceScale: parseFloat(options.guidanceScale),
        speed: parseFloat(options.speed),
        temperature: parseFloat(options.temperature),
      });

      console.log('');
      console.log(chalk.bold.green('✅ 配音完成！'));
      console.log(chalk.dim(`   输出目录: ${path.resolve(options.output)}`));

    } catch (err) {
      console.error(chalk.red(`❌ 错误: ${err.message}`));
      if (process.env.DEBUG) console.error(err);
      process.exit(1);
    }
  });

program
  .command('verify')
  .description('验证输入文件完整性')
  .requiredOption('-s, --subtitles <path>', '字幕文件路径')
  .requiredOption('-a, --audio-dir <dir>', '参考音频目录')
  .action((options) => {
    console.log(chalk.bold.green('🔍 验证输入文件'));
    console.log('');

    if (!fs.existsSync(options.subtitles)) {
      console.error(chalk.red(`❌ 字幕文件不存在: ${options.subtitles}`));
      process.exit(1);
    }

    const srtContent = fs.readFileSync(options.subtitles, 'utf-8');
    const subtitles = parseSRT(srtContent);
    console.log(chalk.cyan(`📄 字幕条目: ${subtitles.length}`));

    if (!fs.existsSync(options.audioDir)) {
      console.error(chalk.red(`❌ 音频目录不存在: ${options.audioDir}`));
      process.exit(1);
    }

    let found = 0;
    let missing = 0;
    for (let i = 0; i < subtitles.length; i++) {
      const num = String(i + 1).padStart(4, '0');
      const audioPath = path.join(options.audioDir, `${num}.wav`);
      if (fs.existsSync(audioPath)) {
        found++;
      } else {
        missing++;
        console.log(chalk.yellow(`   ⚠️  缺失: ${num}.wav`));
      }
    }

    console.log('');
    console.log(chalk.green(`✅ 找到: ${found} 个音频片段`));
    if (missing > 0) {
      console.log(chalk.red(`❌ 缺失: ${missing} 个音频片段`));
      process.exit(1);
    }
  });

program.parse();
