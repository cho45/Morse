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
			gain: 0.5,
			tone: 800,
			wpm: 18,
			character_spacing: 1,
			word_spacing: 1
		};

		if (config) Object.assign(this.config, config);

		this.map = {
			0 : this.createBitBuffer('0'),
			1 : this.createBitBuffer('1'),
			marker : this.createBitBuffer('marker'),
		};

		this.offset = performance.timing.navigationStart;
		this.gain = this.gain || this.context.createGain();
		this.gain.gain.value = 0.5;
		this.gain.connect(this.context.destination);
		this.gain.gain.value = this.config.gain;
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
		}, 500);
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

		const sendingTime = new Date(Math.floor(willSent / 60) * 60 * 1000);
		const dayOfYear = Math.ceil( (sendingTime.getTime() - new Date(sendingTime.getFullYear(), 1, 1).getTime()) / (60 * 60 * 24 * 1000));
		const year = sendingTime.getFullYear() % 100;

		const bit = willSent % 60;
		var code = {
			0: 'marker',

			1: bcd(sendingTime.getMinutes(), 2, 3)[0],
			2: bcd(sendingTime.getMinutes(), 2, 3)[1],
			3: bcd(sendingTime.getMinutes(), 2, 3)[2],
			4: '0',
			5: bcd(sendingTime.getMinutes(), 1, 4)[0],
			6: bcd(sendingTime.getMinutes(), 1, 4)[1],
			7: bcd(sendingTime.getMinutes(), 1, 4)[2],
			8: bcd(sendingTime.getMinutes(), 1, 4)[2],

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

			36:  (bcd(sendingTime.getHours(), 2, 2) + bcd(sendingTime.getHours(), 1, 4)).split('').reduce( (r, i) => r + i, 0) % 2 ,
			37:  (bcd(sendingTime.getMinutes(), 2, 3) + bcd(sendingTime.getMinutes(), 1, 4)).split('').reduce( (r, i) => r + i, 0) % 2 ,
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
		}[bit] || '0';
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
				source.start(startTime + 1);
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

	createBitBuffer : function (type) {
		const tone = this.context.sampleRate / (2 * Math.PI * this.config.tone);
		const border = {
			0: 0.8,
			1: 0.5,
			marker: 0.2
		}[type] * this.context.sampleRate;

		const buffer = this.context.createBuffer(1, this.context.sampleRate, this.context.sampleRate);
		const data   = buffer.getChannelData(0);

		for (var i = 0, len = data.length; i < len; i++) {
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
	jjy.start();

	window.addEventListener('input', function (e) {
		jjy.config[e.target.id] = e.target.value;
		jjy.init();
	});

	document.querySelector('#forceSendCallSign').onchange = function (e) {
		jjy.config.forceSendCallSign = e.target.checked;
		console.log(jjy.config);
	};
});
