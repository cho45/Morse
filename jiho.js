JIHO = function () { this.init.apply(this, arguments) };
JIHO.prototype = {
	init : function (config) {
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

		this.offset = performance.timing.navigationStart;

		this.outputGain = this.context.createGain();
		this.outputGain.connect(this.context.destination);
		this.outputGain.gain.value = this.config.outputGain;

		this.toneGain = this.context.createGain();
		this.toneGain.connect(this.outputGain);
		this.toneGain.gain.value = this.config.toneGain;

		this.voiceGain = this.context.createGain();
		this.voiceGain.connect(this.outputGain);
		this.voiceGain.gain.value = this.config.voiceGain;

		this.voicePath = "./jiho/zunda";
		this.preloadVoiceBuffers();
	},

	start : function () {
		var sent = 0;
		setInterval( () => {
			const time = this.context.currentTime;
			const now =  (this.offset + performance.now()) / 1000;
			const willSent = Math.floor(now + 1);
			if (sent === willSent) return;
			sent = willSent;
			this.queue();
		}, 250);
	},

	/**
	 * 次の1秒の立ちあがりに同期してコードを送信する
	 */
	queue : function () {
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
				data[i] = Math.sin(i++ / tone);
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
				data[i] = Math.sin(i++ / tone);
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
	},

	_voiceBufferCache: {},

	// 1分以内に使う音声ファイルを事前にfetch+decodeしてキャッシュ
	async preloadVoiceBuffers() {
		const ctx = this.context;
		const files = [];
		for (let h = 0; h < 24; h++) files.push(`hour_${h}.mp3`);
		for (let m = 0; m < 60; m++) files.push(`minute_${m}.mp3`);
		for (let s = 0; s < 60; s += 10) files.push(`second_${s}.mp3`);
		const phrases = [
			'正午をお知らせします', 'をお知らせします'
		];
		for (const p of phrases) files.push(`phrase_${p}.mp3`);

		const basePath = this.voicePath;
		const cache = {};
		await Promise.all(files.map(async (file) => {
			try {
				const res = await fetch(`${basePath}/${file}`);
				if (!res.ok) return;
				const buf = await res.arrayBuffer();
				cache[file] = await ctx.decodeAudioData(buf);
			} catch (e) {
				console.warn('preload failed', file, e);
			}
		}));
		this._voiceBufferCache = cache;
	},

	// 指定時刻の音声ファイル名リストを返す
	_voiceNoticeFiles: function(hour, minute, second) {
		const files = [];
		if (hour === 12 && minute === 0 && second === 0) {
			files.push('phrase_正午をお知らせします.mp3');
		} else {
			if (hour > 0) files.push(`hour_${hour}.mp3`);
			if (minute > 0) files.push(`minute_${minute}.mp3`);
			files.push(`second_${second}.mp3`);
			files.push('phrase_をお知らせします.mp3');
		}
		return files;
	},

	// 音声合成ファイルを順次再生（AudioBuffer.durationで正確に連続再生）
	playVoiceNotice: async function(start, hour, minute, second) {
		console.log('playVoiceNotice', hour, minute, second);
		if (second % 10 !== 0) {
			// 秒が10の倍数でない場合は音声再生しない
			return;
		}

		await this.preloadVoiceBuffers();
		const ctx = this.context;
		const files = this._voiceNoticeFiles(hour, minute, second);
		console.log('preloadVoiceBuffers done', files);
		let t = start;
		for (const file of files) {
			let buffer = this._voiceBufferCache[file];
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
	},
};

document.addEventListener("DOMContentLoaded", function (e) {
	const jiho = new JIHO();
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
