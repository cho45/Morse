WAVS := $(wildcard jiho_audio/*.wav)
MP3S := $(patsubst jiho_audio/%.wav,jiho_audio_mp3/%.mp3,$(WAVS))

.PHONY: all

all: $(MP3S)

jiho_audio_mp3/%.mp3: jiho_audio/%.wav
	mkdir -p jiho_audio_mp3
	ffmpeg -y -i $< -codec:a libmp3lame  -b:a 64k $@
