/**
 * SRT 字幕解析器
 * 解析标准 SRT 格式，返回结构化数据
 */

export function parseSRT(content) {
  const entries = [];
  const blocks = content.trim().split(/\n\s*\n/);

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 3) continue;

    const index = parseInt(lines[0].trim(), 10);
    if (isNaN(index)) continue;

    const timeLine = lines[1].trim();
    const timeMatch = timeLine.match(
      /(\d{2}):(\d{2}):(\d{2}),(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{3})/
    );
    if (!timeMatch) continue;

    const startTime =
      parseInt(timeMatch[1]) * 3600 +
      parseInt(timeMatch[2]) * 60 +
      parseInt(timeMatch[3]) +
      parseInt(timeMatch[4]) / 1000;

    const endTime =
      parseInt(timeMatch[5]) * 3600 +
      parseInt(timeMatch[6]) * 60 +
      parseInt(timeMatch[7]) +
      parseInt(timeMatch[8]) / 1000;

    // 合并剩余行作为文本（可能有多行）
    const textLines = lines.slice(2);
    let text = textLines.join('\n').trim();

    // 提取说话人标记
    const speakerMatch = text.match(/^\[(Speaker \d+|说话人\d+)\]\s*(.*)$/s);
    let speaker = null;
    if (speakerMatch) {
      speaker = speakerMatch[1];
      text = speakerMatch[2];
    }

    entries.push({
      index,
      startTime,
      endTime,
      text,
      speaker,
      raw: block,
    });
  }

  return entries;
}

/**
 * 将字幕数组格式化为 SRT 字符串
 */
export function formatSRT(entries) {
  return entries
    .map(
      (entry) =>
        `${entry.index}\n${formatTime(entry.startTime)} --> ${formatTime(
          entry.endTime
        )}\n${entry.speaker ? `[${entry.speaker}] ` : ''}${entry.text}\n`
    )
    .join('\n');
}

function formatTime(seconds) {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(
    secs
  ).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}
