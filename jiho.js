const SECOND_TONE_DURATION = 100e-3; // 秒のトーンの持続時間（秒）
const MINUTES_TONE_DURATION = 3; // 分のトーンの持続時間（秒）
const FADE_DURATION = 4e-3; // フェードアウトの持続時間（秒）
const VOICE_NOTICE_DURATION = 10;

// ClockMonitor: システム時計の大幅な変更（NTP補正・手動変更等）を検知し、イベントを発行するクラス
// WebAudioやperformance.now()はmonotonicな経過時間だが、絶対時刻（Date.now()）はシステム時計依存でジャンプすることがある
// そのため、performance.timeOrigin+performance.now()で絶対時刻を計算している場合、
// システム時計が変化しても自動で補正されない（ズレたままになる）
// このクラスは、定期的にDate.now()とperformance.timeOrigin+performance.now()の差分を監視し、
// 一定以上の差分が発生した場合に"clockchange"イベントを発行することで、
// 利用側がoffset等を補正できるようにする
class ClockMonitor extends EventTarget {
	constructor({ threshold = 2000, interval = 1000 } = {}) {
		super();
		this.threshold = threshold; // 何ms以上の差分で検知するか
		this.interval = interval;   // 監視間隔（ms）
		this.offset = performance.timeOrigin || 0; // performance.now()の起点（初期化時の絶対時刻）
		this._timer = null;
	}

	start() {
		if (this._timer) return;
		this._timer = setInterval(() => {
			const perfNow = performance.now();
			const now = Date.now();
			// 現在の絶対時刻の期待値（初期offset+経過時間）
			const expected = this.offset + perfNow;
			const diff = now - expected;
			// threshold以上の差分が出たらシステム時計変更とみなす
			if (Math.abs(diff) > this.threshold) {
				// offsetを補正し、イベント発行
				this.offset += diff;
				this.dispatchEvent(new CustomEvent("clockchange", {
					detail: { offset: this.offset, diff }
				}));
			}
		}, this.interval);
	}

	stop() {
		if (this._timer) {
			clearInterval(this._timer);
			this._timer = null;
		}
	}
}

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

		this.clockMonitor = new ClockMonitor({
			threshold: 500,
			interval: 100,
		});
		this.clockMonitor.addEventListener("clockchange", (e) => {
			this.offset = e.detail.offset;
			console.log('Clock offset adjusted:', this.offset, 'ms');
		});
		this.clockMonitor.start();
	}

	start() {
		if (this.interval) {
			// すでに再生中なら何もしない
			console.warn('JIHO is already running.');
			return;
		}
		this.preloadVoiceBuffers();
		// sentは絶対時刻（秒単位）で管理することで、システム時計補正やoffset補正の影響を受けにくくする
		let sent = 0;
		this.interval = setInterval(() => {
			const nowSec = Math.floor(Date.now() / 1000);
			if (sent === nowSec) return;
			sent = nowSec;
			this.queue();
		}, 250);
	}

	stop() {
		clearInterval(this.interval);
		this.interval = null;
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
		// console.log(nextSecond);

		// AudioContext における次の1秒の開始時間
		const startTime = anow + nextSecond;

		const sendingTime = new Date(willSent * 1000);
		const sec = sendingTime.getSeconds();

		// 完全無音時間ができるとブラウザの再生中表示がチカチカしてしまうので、
		// 余計にバッファを確保して無音の再生を続けるようにしている

		var send;
		if ( (27 <= sec && sec < 30) || (57 <= sec) ) {
			// 30秒と0秒の前3秒は予告
			const samples = this.context.sampleRate * SECOND_TONE_DURATION;
			const tone = this.context.sampleRate / (2 * Math.PI * this.config.tone3);
			const buffer = this.context.createBuffer(1, this.context.sampleRate + 1e3, this.context.sampleRate);
			const data   = buffer.getChannelData(0);
			for (let i = 0, len = samples; i < len; i++) {
				data[i] = Math.sin(i / tone);
			}
			// remove ticking (fade)
			for (let f = 0, e = this.context.sampleRate * FADE_DURATION; f < e; f++) {
				data[samples - f] = data[samples - f] * (f / e); 
			}
			send = buffer
		} else
		if (sec % 10 === 0) {
			const samples = this.context.sampleRate * MINUTES_TONE_DURATION;
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
			const samples = this.context.sampleRate * SECOND_TONE_DURATION;
			const tone = this.context.sampleRate / (2 * Math.PI * this.config.tone1);
			const buffer = this.context.createBuffer(1, this.context.sampleRate + 1e3, this.context.sampleRate);
			const data   = buffer.getChannelData(0);
			for (let i = 0, len = samples; i < len; i++) {
				data[i] = Math.sin(i / tone);
			}
			// remove ticking (fade)
			for (let f = 0, e = this.context.sampleRate * FADE_DURATION; f < e; f++) {
				data[samples - f] = data[samples - f] * (f / e); 
			}
			send = buffer
		}

		const source = this.context.createBufferSource();
		source.buffer = send;
		source.connect(this.toneGain);
		source.start(startTime);

		const date = new Date(Date.now() + VOICE_NOTICE_DURATION * 1000);
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
		for (const file of files.values()) {
			if (cache[file]) continue;
			cache[file] = (async () => {
				const res = await fetch(`${basePath}/${file}`);
				if (!res.ok) {
					console.error('Failed to fetch voice file:', file, res.status, res.statusText);
					return;
				}
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
		console.log('playVoiceNotice', start, hour, minute, second);

		const ctx = this.context;
		const files = this._voiceNoticeFiles(hour, minute, second);
		let t = start;
		for (const file of files) {
			let buffer = await this._voiceBufferCache[file];
			if (!buffer) {
				// キャッシュにない場合は今回スキップ
				console.warn('Voice buffer not found in cache:', file);
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
