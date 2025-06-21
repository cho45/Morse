#!/bin/sh
# 指定ディレクトリ内の全WAVファイルをmp3に一括変換し、DIR_mp3に保存
# 使い方: sh wav2mp3.sh [ディレクトリ名]
# ffmpegが必要です

set -e
DIR="$1"
if [ -z "$DIR" ]; then
  echo "Usage: sh wav2mp3.sh [ディレクトリ名]"
  exit 1
fi
OUTDIR="${DIR}_mp3"
mkdir -p "$OUTDIR"
for f in "$DIR"/*.wav; do
  [ -e "$f" ] || continue
  base=$(basename "$f" .wav)
  ffmpeg -y -i "$f" -codec:a libmp3lame -b:a 64k "$OUTDIR/$base.mp3"
done
