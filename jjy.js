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


JJY = function () { this.init.apply(this, arguments) };
JJY.prototype = {
	init : function (config) {
		this.context = this.context || new AudioContext();
		this.config = this.config || {
			error: 0,
			gain: 0.5,
			tone: 800,
			wpm: 15,
			character_spacing: 1,
			word_spacing: 1
		};

		if (config) Object.assign(this.config, config);

		this.map = {
			0 : this.createBitBuffer('0'),
			1 : this.createBitBuffer('1'),
			marker : this.createBitBuffer('marker'),
		};

		this.offset = performance.timing.navigationStart - this.config.error;

		// TODO
		const params = new URLSearchParams(location.hash.slice(1));
		if (params.get('offset')) {
			this.offset = +params.get('offset');
		}
		this.gain = this.gain || this.context.createGain();
		this.gain.connect(this.context.destination);
		this.gain.gain.value = this.config.gain;
		this.bits = null;
		this.playing = false;
	},

	start : function () {
		this.playing = true;
		var sent = 0;
		this.timer = setInterval( () => {
			if (!this.playing) return;
			const time = this.context.currentTime;
			const now =  (this.offset + performance.now()) / 1000;
			const willSent = Math.floor(now + 1);
			if (sent === willSent) return;
			sent = willSent;
			this.queue();
		}, 250);
	},

	stop: function () {
		clearInterval(this.timer);
		this.playing = false;
		this.bits = null;
	},

	/**
	 * 次の1秒の立ちあがりに同期してコードを送信する
	 */
	queue : function () {
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

		const sendingTime = new Date(Math.floor(willSent / 60) * 60 * 1000);

		const bit = willSent % 60;
		this.bits = this.getAllBits(sendingTime);
		let code = this.bits[bit] || '0';
		console.log(bit, code, sendingTime);

		var willSendingCallSign =
			sendingTime.getMinutes() === 15 ||
			sendingTime.getMinutes() === 45;
		if (this.config.forceSendCallSign) {
			willSendingCallSign = true;
		}

		if (willSendingCallSign) {
			if (bit === 40) {
				// send call sign JJY
				const source = this.context.createBufferSource();
				source.buffer = this.createToneBuffer("JJY JJY");
				source.connect(this.gain);
				source.start(startTime + 0.5);
				return;
			} else
			if (40 <= bit && bit <= 48) {
				// skip
				return;
			} else
			if (50 <= bit && bit <= 58) {
				// 停波予告はなし
				code = '0';
			}
		}

		const source = this.context.createBufferSource();
		source.buffer = map[code];
		source.connect(this.gain);
		source.start(startTime);
	},

	getAllBits: function (sendingTime) {
		function bcd (number, digit, bits) {
			return (Math.floor(number % Math.pow(10, digit) / Math.pow(10, digit - 1)) + Math.pow(2, bits)).toString(2).substring(1);
		}
		// 1月1日を1とした通算日
		const dayOfYear = Math.floor((sendingTime.getTime() - new Date(sendingTime.getFullYear(), 0, 1).getTime()) / (60 * 60 * 24 * 1000)) + 1;
		const year = sendingTime.getFullYear() % 100;
		return {
			0: 'marker',

			1: bcd(sendingTime.getMinutes(), 2, 3)[0],
			2: bcd(sendingTime.getMinutes(), 2, 3)[1],
			3: bcd(sendingTime.getMinutes(), 2, 3)[2],
			4: '0',
			5: bcd(sendingTime.getMinutes(), 1, 4)[0],
			6: bcd(sendingTime.getMinutes(), 1, 4)[1],
			7: bcd(sendingTime.getMinutes(), 1, 4)[2],
			8: bcd(sendingTime.getMinutes(), 1, 4)[3],

			9: 'marker',
			10: '0',
			11: '0',

			12: bcd(sendingTime.getHours(), 2, 2)[0],
			13: bcd(sendingTime.getHours(), 2, 2)[1],
			14: '0',
			15: bcd(sendingTime.getHours(), 1, 4)[0],
			16: bcd(sendingTime.getHours(), 1, 4)[1],
			17: bcd(sendingTime.getHours(), 1, 4)[2],
			18: bcd(sendingTime.getHours(), 1, 4)[3],

			19: 'marker',
			20: '0',
			21: '0',
			22: bcd(dayOfYear, 3, 2)[0],
			23: bcd(dayOfYear, 3, 2)[1],
			24: '0',
			25: bcd(dayOfYear, 2, 4)[0],
			26: bcd(dayOfYear, 2, 4)[1],
			27: bcd(dayOfYear, 2, 4)[2],
			28: bcd(dayOfYear, 2, 4)[3],
			29: 'marker',
			30: bcd(dayOfYear, 1, 4)[0],
			31: bcd(dayOfYear, 1, 4)[1],
			32: bcd(dayOfYear, 1, 4)[2],
			33: bcd(dayOfYear, 1, 4)[3],
			34: '0',
			35: '0',

			// PA1 = (20h+10h+8h+4h+2h+1h) mod 2
			36:  (bcd(sendingTime.getHours(), 2, 2) + bcd(sendingTime.getHours(), 1, 4)).split('').map(i => +i).reduce( (r, i) => r + i, 0) % 2 ,
			// PA2 = (40m+20m+10m+8m+4m+2m+1m) mod 2
			37:  (bcd(sendingTime.getMinutes(), 2, 3) + bcd(sendingTime.getMinutes(), 1, 4)).split('').map( i => +i).reduce( (r, i) => r + i, 0) % 2 ,
			38: '0',

			39: 'marker',
			40: '0',
			41: bcd(year, 2, 4)[0],
			42: bcd(year, 2, 4)[1],
			43: bcd(year, 2, 4)[2],
			44: bcd(year, 2, 4)[3],
			45: bcd(year, 1, 4)[0],
			46: bcd(year, 1, 4)[1],
			47: bcd(year, 1, 4)[2],
			48: bcd(year, 1, 4)[3],

			49: 'marker',

			50: bcd(sendingTime.getDay(), 1, 3)[0],
			51: bcd(sendingTime.getDay(), 1, 3)[1],
			52: bcd(sendingTime.getDay(), 1, 3)[2],

			// うるう秒
			53: '0',
			54: '0',

			55: '0',
			56: '0',
			57: '0',
			58: '0',

			59: 'marker'
		}
	},

	createBitBuffer : function (type) {
		const tone = this.context.sampleRate / (2 * Math.PI * this.config.tone);
		const border = {
			0: 0.8,
			1: 0.5,
			marker: 0.2
		}[type] * this.context.sampleRate;

		const samples = this.context.sampleRate;
		const buffer = this.context.createBuffer(1, samples + 1e3, this.context.sampleRate);
		const data   = buffer.getChannelData(0);

		for (var i = 0, len = samples; i < len; i++) {
			data[i] = Math.sin(i / tone) * (i < border ? 1 : 0.1);
		}

		return buffer;
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
	const jjy = new JJY();

	const inputPlay = document.getElementById('play');
	inputPlay.onclick = () => {
		if (!jjy.playing) {
			jjy.start();
			inputPlay.textContent = '停止';
		} else {
			jjy.stop();
			inputPlay.textContent = '再生';
		}
	};

	const inputTone = document.getElementById('tone');
	const inputGain = document.getElementById('gain');
	document.getElementById('syncMode').onchange = (e) => {
		if (e.target.checked) {
			jjy.config.tone = 40e3 / 3;
			jjy.config.gain = 10;
			inputTone.disabled = true;
			inputGain.disabled = true;
		} else {
			jjy.config.tone = inputTone.value;
			jjy.config.gain = inputGain.value;
			inputTone.disabled = false;
			inputGain.disabled = false;
		}
		jjy.init();
	};

	window.addEventListener('input', function (e) {
		jjy.config[e.target.id] = e.target.value;
		jjy.init();
	});

	document.querySelector('#forceSendCallSign').onchange = function (e) {
		jjy.config.forceSendCallSign = e.target.checked;
		console.log(jjy.config);
	};

	const canvasElement = document.getElementById('canvas');
	const ctx = canvasElement.getContext('2d');
	function renderCanvas(bits) {
		if (!bits) return;
		const PADDING = 10;
		const WIDTH   = canvasElement.width - PADDING * 2;
		ctx.save();
		ctx.translate(PADDING, PADDING);
		ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
		// 60秒を20秒ごとに3行に分割して表示
		ctx.textAlign = "left";
		ctx.textBaseline = "top";


		ctx.strokeStyle = '#000000';
		ctx.lineWidth = 1;

		const ONE_SEC = WIDTH / 20;
		const WAVE_HEIGHT = 100;

		const CURRENT_BIT = Math.floor(Date.now() / 1000) % 60;
		const INTERPRET = [
			{
				start: 1,
				end: 8,
				name: '分',
			},
			{
				start: 10,
				end: 18,
				name: '時',
			},
			{
				start: 22,
				end: 33,
				name: '通算日',
			},
			{
				start: 36,
				end: 37,
				name: 'パリティ',
			},
			{
				start: 41,
				end: 48,
				name: '年',
			},
			{
				start: 50,
				end: 52,
				name: '曜日',
			},
			{
				start: 53,
				end: 54,
				name: 'うるう秒',
			},
		];

		for (let line = 0; line < 3; line++) {
			const offset = line * 20;

			ctx.beginPath();
			ctx.moveTo(0, 0,);
			ctx.lineTo(WIDTH, 0);

			// 1秒ごとのメモリ
			ctx.font = '24px monospace';
			for (let i = 0; i < 20; i++) {
				const x = i * ONE_SEC;
				ctx.moveTo(x, 0);
				ctx.lineTo(x, i % 10 === 0 ? 30 : 10);
				ctx.fillText(offset + i, x + 5, 0);
			}
			ctx.stroke();

			// 1秒ごとの波形
			ctx.translate(0, 100);

			const drawWave = function (x, bit) {
				const base = WAVE_HEIGHT * 0.1;
				ctx.fillRect(x, base / -2, ONE_SEC, base);

				const border = {
					0: 0.8,
					1: 0.5,
					marker: 0.2
				}[bit];

				ctx.fillRect(x, WAVE_HEIGHT / -2, ONE_SEC * border, WAVE_HEIGHT);

				ctx.fillStyle = {
					0: 'rgb(50 186 0)',
					1: 'rgb(227 121 0)',
					marker: 'rgb(83 163 250)',
				}[bit];
				ctx.fillRect(x, WAVE_HEIGHT / 2 + 10, ONE_SEC * border, 10);

				ctx.fillStyle = '#333'
				ctx.font = '32px monospace';
				ctx.fillText(bit === 'marker' ? 'M' : bit, x, WAVE_HEIGHT / 2 + 20);
			}

			for (let i = 0; i < 20; i++) {
				ctx.fillStyle = (offset + i) === CURRENT_BIT ? 'hsl(200deg 21% 80%)' : 'hsl(200deg 21% 49%)';
				const bit = bits[offset + i];
				drawWave(i * ONE_SEC, bit);
			}

			ctx.translate(0, WAVE_HEIGHT + 10);

			INTERPRET.filter( i => i.start >= offset && i.end < offset + 20).forEach( (i, index) => {
				const start = ONE_SEC * (i.start - offset);
				const end   = ONE_SEC * (i.end - offset + 1);
				ctx.beginPath();
				ctx.moveTo(start, 0);
				ctx.lineTo(start + ONE_SEC / 2, 24);
				ctx.lineTo(end - ONE_SEC / 2, 24);
				ctx.lineTo(end, 0);
				ctx.stroke();
				ctx.font = '24px monospace';
				ctx.fillText(i.name, start + ONE_SEC / 2, 0);
			});

			ctx.translate(0, 100);
		}

		ctx.restore();
	}

	const timeElement = document.getElementById('time');

	var count = 0, time = 0, fps = 0;
	const render = function me () {
		const date = new Date();

		count++;
		if (date.getTime() - time > 1000) {
			time = date.getTime();
			fps = count;
			count = 0;
		}

		timeElement.textContent = 
			date.getFullYear() + '-' + String(100 + date.getMonth() + 1).substring(1) + '-' + String(100 + date.getDay()).substring(1) + ' ' +
			String(100 + date.getHours()).substring(1) + ':' + String(100 + date.getMinutes()).substring(1) + ":" + String(100 + date.getSeconds()).substring(1) + "." +
			String(1000 + date.getMilliseconds()).substring(1) + ' ' + '(' + fps + ' fps)';

		renderCanvas(jjy.bits);

		requestAnimationFrame(me);
	};
	render();

});
