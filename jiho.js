class JIHO {
	constructor(config) {
		this.context = this.context || new AudioContext();
		/* NTT
		this.config = this.config || {
			gain: 0.5,
			tone1: 2000,
			tone2: 1000,
			tone3: 500
		};
		*/
		this.config = {
			toneGain: 0.5,
			tone1: 1760,
			tone2: 880,
			tone3: 440,
			outputGain: 0.9,
			voiceGain: 2,
		};

		if (config) Object.assign(this.config, config);

		this.offset = performance.timeOrigin || 0;

		this.outputGain = this.context.createGain();
		this.outputGain.connect(this.context.destination);
		this.outputGain.gain.value = this.config.outputGain;

		this.toneGain = this.context.createGain();
		this.toneGain.connect(this.outputGain);
		this.toneGain.gain.value = this.config.toneGain;

		this.voiceGain = this.context.createGain();
		this.voiceGain.connect(this.outputGain);
		this.voiceGain.gain.value = this.config.voiceGain;

		this.highpass = this.context.createBiquadFilter();
		this.highpass.type = "highpass";
		this.highpass.frequency.value = 300;

		this.lowpass = this.context.createBiquadFilter();
		this.lowpass.type = "lowpass";
		this.lowpass.frequency.value = 3400;

		if (config.telephone) {
			// outputGain → highpass → lowpass → destination
			this.outputGain.disconnect();
			this.outputGain.connect(this.highpass);
			this.highpass.connect(this.lowpass);
			this.lowpass.connect(this.context.destination);
		}

		this.voicePath = this.config.voicePath || "./jiho/zunda";
		this._voiceBufferCache = {};
		this.preloadVoiceBuffers();
	}

	start() {
		this.preloadVoiceBuffers();
		var sent = 0;
		this.interval = setInterval(() => {
			const time = this.context.currentTime;
			const now =  (this.offset + performance.now()) / 1000;
			const willSent = Math.floor(now + 1);
			if (sent === willSent) return;
			sent = willSent;
			this.queue();
		}, 250);
	}

	stop() {
		clearInterval(this.interval);
	}

	/**
	 * 次の1秒の立ちあがりに同期してコードを送信する
	 */
	queue() {
		function bcd (number, digit, bits) {
			return (Math.floor(number % Math.pow(10, digit) / Math.pow(10, digit - 1)) + Math.pow(2, bits)).toString(2).substring(1);
		}
		const map = this.map;

		const now = performance.now();
		const anow = this.context.currentTime;
		
		const inow =  (this.offset + now) / 1000;
		const willSent = Math.floor(inow + 1);

		// 必要ない1秒以上の桁を捨てて計算
		const nnow = (this.offset % 1000) / 1000 + (now / 1000);
		// 次の1秒の立ちあがりまでの時間
		const nextSecond = Math.floor(nnow + 1) - nnow;
		console.log(nextSecond);

		// AudioContext における次の1秒の開始時間
		const startTime = anow + nextSecond;

		const sendingTime = new Date(willSent * 1000);
		const sec = sendingTime.getSeconds();

		// 完全無音時間ができるとブラウザの再生中表示がチカチカしてしまうので、
		// 余計にバッファを確保して無音の再生を続けるようにしている

		var send;
		if ( (27 <= sec && sec < 30) || (57 <= sec) ) {
			// 予告
			const samples = this.context.sampleRate * 100e-3;
			const tone = this.context.sampleRate / (2 * Math.PI * this.config.tone3);
			const buffer = this.context.createBuffer(1, this.context.sampleRate + 1e3, this.context.sampleRate);
			const data   = buffer.getChannelData(0);
			for (let i = 0, len = samples; i < len; i++) {
				data[i] = Math.sin(i / tone);
			}
			// remove ticking (fade)
			for (let f = 0, e = this.context.sampleRate * 0.004; f < e; f++) {
				data[samples - f] = data[samples - f] * (f / e); 
			}
			send = buffer
		} else
		if (sec % 10 === 0) {
			const samples = this.context.sampleRate * 3;
			const tone = this.context.sampleRate / (2 * Math.PI * this.config.tone2);
			const buffer = this.context.createBuffer(1, samples + 1e3, this.context.sampleRate);
			const data   = buffer.getChannelData(0);
			var x = 0;
			for (let i = 0, len = this.context.sampleRate; i < len; i++) {
				data[i] = Math.sin(x++ / tone);
			}
			for (let i = this.context.sampleRate, len = this.context.sampleRate * 2; i < len; i++) {
				data[i] = Math.sin(x++ / tone) * (1 - i / len);
			}
			send = buffer
		} else {
			const samples = this.context.sampleRate * 100e-3
			const tone = this.context.sampleRate / (2 * Math.PI * this.config.tone1);
			const buffer = this.context.createBuffer(1, this.context.sampleRate + 1e3, this.context.sampleRate);
			const data   = buffer.getChannelData(0);
			for (let i = 0, len = samples; i < len; i++) {
				data[i] = Math.sin(i / tone);
			}
			// remove ticking (fade)
			for (let f = 0, e = this.context.sampleRate * 0.004; f < e; f++) {
				data[samples - f] = data[samples - f] * (f / e); 
			}
			send = buffer
		}

		const source = this.context.createBufferSource();
		source.buffer = send;
		source.connect(this.toneGain);
		source.start(startTime);

		const date = new Date(Date.now() + 10 * 1000);
		this.playVoiceNotice(startTime + 0.5, date.getHours(), date.getMinutes(), date.getSeconds());
	}

	// 1分以内に使う音声ファイルのみfetch+decodeしてキャッシュ
	async preloadVoiceBuffers() {
		if (this.voicePath === null) return;
		const ctx = this.context;
		const files = new Set();
		const now = new Date();
		for (let i = 10; i < 60; i++) {
			const t = new Date(now.getTime() + i * 1000);
			const hour = t.getHours();
			const minute = t.getMinutes();
			const second = t.getSeconds();
			if (second % 10 !== 0) {
				continue;
			}
			for (const f of this._voiceNoticeFiles(hour, minute, second)) {
				files.add(f);
			}
		}
		const basePath = this.voicePath;
		const cache = this._voiceBufferCache;
		console.log('preloadVoiceBuffers', files);
		for (const file of files.values()) {
			if (cache[file]) continue;
			cache[file] = (async () => {
				const res = await fetch(`${basePath}/${file}`);
				if (!res.ok) return;
				const buf = await res.arrayBuffer();
				const audioData = await ctx.decodeAudioData(buf);
				console.log('preloaded', file, audioData.duration);
				return audioData;
			})();
		}
	}

	// 指定時刻の音声ファイル名リストを返す
	_voiceNoticeFiles(hour, minute, second) {
		const files = [];
		if (hour === 12 && minute === 0 && second === 0) {
			files.push('phrase_正午をお知らせします.mp3');
		} else {
			files.push(`hour_${hour}.mp3`);
			if (minute > 0) files.push(`minute_${minute}.mp3`);
			files.push(`second_${second}.mp3`);
			files.push('phrase_をお知らせします.mp3');
		}
		return files;
	}

	// 音声合成ファイルを順次再生（AudioBuffer.durationで正確に連続再生）
	async playVoiceNotice(start, hour, minute, second) {
		if (this.voicePath === null) return;

		if (second % 10 !== 0) {
			// 秒が10の倍数でない場合は音声再生しない
			return;
		}
		this.preloadVoiceBuffers();

		const ctx = this.context;
		const files = this._voiceNoticeFiles(hour, minute, second);
		let t = start;
		for (const file of files) {
			let buffer = await this._voiceBufferCache[file];
			if (!buffer) {
				// キャッシュにない場合は今回スキップ
				return;
			}
			const src = ctx.createBufferSource();
			src.buffer = buffer;
			src.connect(this.voiceGain);
			src.start(t);
			t += buffer.duration;
		}
	}
}

document.addEventListener("DOMContentLoaded", function (e) {
	const params = new URLSearchParams(location.search);
	const voice = params.get('voice') || 'metan';
	const telephone = params.has('telephone') ? params.get('telephone') === 'true' : false;
	console.log({voice, telephone});

	const VOICES = [
		{
			id: 'none',
			credit: '',
			voicePath: null,
		},
		{
			id: 'metan',
			credit: '声: VOICEVOX:四国めたん',
			voicePath: './jiho/metan',
		},
		{
			id: 'zunda',
			credit: '声: VOICEVOX:ずんだもん',
			voicePath: './jiho/zunda',
		}
	]

	let voiceParams = VOICES.find(v => v.id === voice);
	if (!voiceParams) {
		console.error('Invalid voice parameter:', voice);
		voiceParams = VOICES[0]; // デフォルトは最初の音声
		return;
	}

	document.getElementById('credit').textContent = voiceParams.credit;

	const jiho = new JIHO({
		voicePath: voiceParams.voicePath,
		telephone,
	});
	document.getElementById('play').onclick = () => {
		jiho.start();
		document.getElementById('play').disabled = true;
	};

	const dateElem = document.getElementById('date');
	const clockElem = document.getElementById('clock');
	const element = document.getElementById('time');
	var count = 0, time = 0, fps = 0;
	const renderTime = function me () {
		const date = new Date();

		count++;
		if (date.getTime() - time > 1000) {
			time = date.getTime();
			fps = count;
			count = 0;
		}

		// 日付
		dateElem.textContent =
			date.getFullYear() + '-' + String(100 + date.getMonth() + 1).substring(1) + '-' + String(100 + date.getDate()).substring(1);
		// 時刻（ミリ秒以下も表示）
		clockElem.textContent =
			String(100 + date.getHours()).substring(1) + ':' +
			String(100 + date.getMinutes()).substring(1) + ':' +
			String(100 + date.getSeconds()).substring(1) + '.' +
			String(1000 + date.getMilliseconds()).substring(1);

		element.textContent =
			date.getFullYear() + '-' + String(100 + date.getMonth() + 1).substring(1) + '-' + String(100 + date.getDate()).substring(1) + ' ' +
			String(100 + date.getHours()).substring(1) + ':' + String(100 + date.getMinutes()).substring(1) + ":" + String(100 + date.getSeconds()).substring(1) + "." +
			String(1000 + date.getMilliseconds()).substring(1) + ' ' + '(' + fps + ' fps)';

		requestAnimationFrame(me);
	};
	renderTime();
});
