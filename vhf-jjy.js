navigator.getMedia = (
	navigator.getUserMedia ||
	navigator.webkitGetUserMedia ||
	navigator.mozGetUserMedia ||
	navigator.msGetUserMedia
);

window.AudioContext = (
	window.AudioContext ||
	window.webkitAudioContext ||
	window.mozAudioContext ||
	window.msAudioContext
);


VHFJJY = function () { this.init.apply(this, arguments) };
VHFJJY.prototype = {
	init : function (config) {
		this.context = this.context || new AudioContext();
		this.config = this.config || {
			gain: 0.5,
			tone: 1000,
			wpm: 18,
			character_spacing: 1,
			word_spacing: 1
		};

		if (config) Object.assign(this.config, config);

		this.offset = performance.timing.navigationStart;
		this.gain = this.gain || this.context.createGain();
		this.gain.gain.value = 0.5;
		this.gain.connect(this.context.destination);
		this.gain.gain.value = this.config.gain;

		{
			const secondSamples = this.context.sampleRate * 5e-3; // 5ms
			const secondTone    = this.context.sampleRate / (2 * Math.PI * 1600);
			const secondBuffer = this.context.createBuffer(1, secondSamples + 1e3, this.context.sampleRate);
			const data = secondBuffer.getChannelData(0);
			for (let i = 0, len = secondSamples; i < len; i++) {
				data[i] = Math.sin(i / secondTone);
			}
			this.secondBuffer = secondBuffer;
		}

		{
			const minutesSamples = this.context.sampleRate * (0.700 - 0.045);
			const minutesTone = this.context.sampleRate / (2 * Math.PI * 600);
			const minutesBuffer = this.context.createBuffer(1, minutesSamples + 1e3, this.context.sampleRate);
			const data = minutesBuffer.getChannelData(0);
			for (let i = 0, len = minutesSamples; i < len; i++) {
				data[i] = Math.sin(i / minutesTone);
			}
			this.minutesBuffer = minutesBuffer;
		}
		{
			const tenMinutesSamples = this.context.sampleRate * (0.960 - 0.045);
			const tenMinutesTone = this.context.sampleRate / (2 * Math.PI * 1000);
			const tenMinutesBuffer = this.context.createBuffer(1, tenMinutesSamples + 1e3, this.context.sampleRate);
			const data = tenMinutesBuffer.getChannelData(0);
			for (var i = 0, len = tenMinutesSamples; i < len; i++) {
				data[i] = Math.sin(i / tenMinutesTone);
			}
			this.tenMinutesBuffer = tenMinutesBuffer;
		}
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

	queue : function () {
		const now = performance.now();
		const anow = this.context.currentTime;
		
		const inow =  (this.offset + now) / 1000;
		const willSent = Math.floor(inow + 1);

		// 必要ない1秒以上の桁を捨てて計算
		const nnow = (this.offset % 1000) / 1000 + (now / 1000);
		// 次の1秒の立ちあがりまでの時間
		const nextSecond = Math.floor(nnow + 1) - nnow;
		// AudioContext における次の1秒の開始時間
		const startTime = anow + nextSecond;

		const sendingTime = new Date(willSent * 1000);
		console.log(sendingTime, nextSecond);

		if (35 <= sendingTime.getMinutes() && sendingTime.getMinutes() <  39) {
			this.status = "stop for calibration"
			// 較正のため停止
			return;
		}

		// 秒信号
		const source = this.context.createBufferSource();
		source.buffer = this.secondBuffer;
		source.connect(this.gain);
		source.start(startTime);
		this.status = "second";

		// 分信号
		if (sendingTime.getSeconds() === 59) {
			this.status = "minute";
			const source = this.context.createBufferSource();
			source.buffer = this.minutesBuffer;
			source.connect(this.gain);
			source.start(startTime + 0.045);
		}
		
		// 10分信号
		if (sendingTime.getMinutes() % 10 <= 4) {
			console.log('10min');
			this.status = "10 minutes";
			if (sendingTime.getSeconds() === 59) {
				// 毎分59秒は送信しない
			} else {
				// x0分0.045秒〜4分58.960秒まで 1000Hz で 0.045〜0.960秒まで送信
				const source = this.context.createBufferSource();
				source.buffer = this.tenMinutesBuffer;
				source.connect(this.gain);
				source.start(startTime + 0.045);
			}
		}

		// コール
		if (sendingTime.getMinutes() % 10 === 9) {
			if (sendingTime.getSeconds() === 30) {
				this.status = "sending callsign";
				const targetTime = new Date( Math.floor((willSent + 60) / 60) * 60 * 1000);
				console.log('call', targetTime);

				const hhmm = String(100 + targetTime.getHours()).substring(1) + String(100 + targetTime.getMinutes()).substring(1);

				// TODO 音声
				// http://jjy.nict.go.jp/QandA/reference/JJYwav.html が再配布禁止なのでむずかしい
				const source = this.context.createBufferSource();
				source.buffer = this.createToneBuffer("JJY JJY " + hhmm + "             NNNNN");
				source.connect(this.gain);
				source.start(startTime + 1);
			}
		}
	},

	createToneBuffer : function (code) {
		var speed = 
			this.config.cpm ? 6000 / this.config.cpm:
			this.config.wpm ? 1200 / this.config.wpm:
				50;
		var unit = this.context.sampleRate * (speed / 1000);
		var tone = this.context.sampleRate / (2 * Math.PI * this.config.tone);

		var sequence = [], length = 0;
		for (var i = 0, n, len = code.length; i < len; i++) {
			var c = code.charAt(i).toUpperCase();
			if (c === ' ') {
				n = 7 * this.config.word_spacing * unit;
				length += n;
				sequence.push(-n);
			} else {
				var m = Morse.codes[c];
				for (var j = 0, mlen = m.length; j < mlen; j++) {
					var mc = m.charAt(j);
					if (mc === '.') {
						n = 1 * unit;
						length += n;
						sequence.push(n);
					} else
					if (mc === '-') {
						n = 3 * unit;
						length += n;
						sequence.push(n);
					}
					if (j < mlen - 1) {
						n = 1 * unit;
						length += n;
						sequence.push(-n);
					}
				}
				n = 3 * this.config.character_spacing * unit;
				length += n;
				sequence.push(-n);
			}
		}
		length = Math.ceil(length);

		var buffer = this.context.createBuffer(1, Math.ceil(length), this.context.sampleRate);
		var data   = buffer.getChannelData(0);

		for (var i = 0, x = 0, len = sequence.length; i < len; i++) {
			var s = sequence[i];
			if (s < 0) {
				while (s++ < 0) {
					data[x++] = 0;
				}
			} else {
				for (var p = 0; p < s; p++) {
					data[x++] = Math.sin(p / tone);
				}
				// remove ticking (fade)
				for (var f = 0, e = this.context.sampleRate * 0.004; f < e; f++) {
					data[x - f] = data[x - f] * (f / e); 
				}
			}
		}

		return buffer;
	}
};

document.addEventListener("DOMContentLoaded", function (e) {
	const jjy = new VHFJJY();
	document.getElementById('play').onclick = () => {
		jjy.start();
	};

	window.addEventListener('input', function (e) {
		jjy.config[e.target.id] = e.target.value;
		jjy.init();
	});

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

		element.textContent = 
			date.getFullYear() + '-' + String(100 + date.getMonth() + 1).substring(1) + '-' + String(100 + date.getDay()).substring(1) + ' ' +
			String(100 + date.getHours()).substring(1) + ':' + String(100 + date.getMinutes()).substring(1) + ":" + String(100 + date.getSeconds()).substring(1) + "." +
			String(1000 + date.getMilliseconds()).substring(1) + ' ' + '(' + fps + ' fps)' + ' ' + jjy.status;

		requestAnimationFrame(me);
	};
	renderTime();
});
