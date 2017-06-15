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
		this.config = this.config || {
			gain: 0.5,
			tone1: 1760,
			tone2: 880,
			tone3: 440
		};

		if (config) Object.assign(this.config, config);

		this.offset = performance.timing.navigationStart;
		this.gain = this.gain || this.context.createGain();
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
		source.connect(this.gain);
		source.start(startTime);
	}
};

document.addEventListener("DOMContentLoaded", function (e) {
	const jiho = new JIHO();
	document.getElementById('play').onclick = () => {
		jiho.start();
	};

	window.addEventListener('input', function (e) {
		jiho.config[e.target.id] = e.target.value;
		jiho.init();
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
			String(1000 + date.getMilliseconds()).substring(1) + ' ' + '(' + fps + ' fps)';

		requestAnimationFrame(me);
	};
	renderTime();
});
