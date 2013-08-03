/**
 *
 * memo
 * CW のトーンは 800Hz 前後
 * 短点の長さは約50ms
 *
 * 1. トーン周波数を特定する
 */

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

CWDecoder = function () { this.init.apply(this, arguments) };
CWDecoder.prototype = {
	init : function (config) {
		var self = this;

		self.freqCanvas = document.getElementById('freq');
		self.freq2dContext = self.freqCanvas.getContext('2d');

		self.historyCanvas = document.getElementById('history');
		self.history2dContext = self.historyCanvas.getContext('2d');

		self.context = new AudioContext();

		// 4kHz 程度でサンプリングすれば十分カバーできるのでダウンサンプリングする
		self.DOWNSAMPLING_FACTOR = 10;
		self.SAMPLES_BUFFER_LENGTH = 8; // sec
		self.FFT_SIZE = 1024;

		self.downSampleRate     = self.context.sampleRate / self.DOWNSAMPLING_FACTOR;

		// 循環バッファ
		self.samples = new Float32Array(self.downSampleRate * self.SAMPLES_BUFFER_LENGTH);
		// 循環バッファ次に書きこむインデックス
		self.samples.index = 0;

		self.FFT = new FFT(self.FFT_SIZE, self.downSampleRate);
		self.fftBuffer = new Float32Array(self.FFT_SIZE);
		console.log(['FFT Band Width:', self.FFT.bandwidth]);

		self.targetTone = 600;

		self.offset = 0;

		self.clockHistory = [50, 50, 50, 50, 50, 50, 50, 50, 50, 50];
		self.peakBandHistory = [];

		self.decoded = [];

		self.setConfig(config);
	},

	setConfig : function (config) {
		var self = this;
		self.config = config;

		// dot length in msec
		self.speed = 
			config.cpm ? 6000 / config.cpm:
			config.wpm ? 1200 / config.wpm:
				50;

		// sampling cycle of sine wave for specific tone frequency
		self.tone = self.context.sampleRate / (2 * Math.PI * config.tone);
		self.unit  = self.context.sampleRate * (self.speed / 1000);

		console.log(['speed', self.speed]);
		console.log(['tone', self.tone]);
		console.log(['unit', self.unit]);
	},

	start : function () {
		var self = this;

		var useDummy = 1;
		if (useDummy) {
//			navigator.getMedia({ video: false, audio: true }, function (stream) {
//				var source = self.context.createMediaStreamSource(stream);
//
//				var dummy = self.createDummy();
//				dummy.gain.value = 0.3;
//
//				var gain = self.context.createGain();
//				source.connect(gain);
//				dummy.connect(gain);
//
//				self.decode(gain);
//			}, function (e) {
//				alert(e);
//			});
			var dummy = self.createDummy();
			self.decode(dummy);
		} else {
			navigator.getMedia({ video: false, audio: true }, function (stream) {
				var source = self.context.createMediaStreamSource(stream);
				self.decode(source);
			}, function (e) {
				alert(e);
			});
		}
	},

	decode : function (source) {
		var self = this;

		var lowpass = self.context.createBiquadFilter();
		lowpass.frequency.value = 1800;

		var gain = self.context.createGain();
		gain.gain.value = 0;

		var processor = self.context.createScriptProcessor(4096, 1, 1);
		var samplingCount = 0;
		var unread = 0;
		var samples = self.samples;
		processor.onaudioprocess = function (e) {
			var inputData = e.inputBuffer.getChannelData(0);
			for (var len = inputData.length; samplingCount < len; samplingCount += self.DOWNSAMPLING_FACTOR) {
				unread++;
				samples[samples.index++ % samples.length] = inputData[samplingCount];
			}
			samplingCount = samplingCount - len; // はみだしたぶんを次回へ
			samples.index = samples.index % samples.length;
			processor.onaudioprocess = arguments.callee; // なんかセットしないと止まることがある
		};
		source.connect(lowpass);
		lowpass.connect(processor);
		processor.connect(gain); // destination に繋がないと何もしないみたい……
		gain.connect(self.context.destination);

		setInterval(function () {
			if (!unread) {
				console.log([samples.index, samples.length]);
				console.log('onaudioprocess stopped?');
				return;
			}

			self.freq2dContext.fillStyle = '#000000';
			self.freq2dContext.fillRect(0, 0, self.freqCanvas.width, self.freqCanvas.height);

			self.history2dContext.fillStyle = '#000000';
			self.history2dContext.fillRect(0, 0, self.historyCanvas.width, self.historyCanvas.width);

			self.executeFFT();
			self.updateTargetTone();

			self.drawSpectrum();
			self.processDecode(unread);

			unread = 0;
		}, 250);
	},

	updateTargetTone : function () {
		var self = this;
		/**
		 * 最初は適当にピーク周波数をトラッキングする
		 *
		 */

		// TODO: 平均から離れて大きいほど選択されやすくなるようにしたい
		var frequency = self.FFT.getBandFrequency(self.FFT.peakBand);
		// 300Hz - 1200Hz 以外は無視する
		if (frequency < 300 || 1200 < frequency) {
			return;
		}

		self.peakBandHistory.push(frequency);
		while (self.peakBandHistory.length > 20) self.peakBandHistory.shift();

		var avg = 0;
		for (var i = 0, len = self.peakBandHistory.length; i < len; i++) {
			avg += self.peakBandHistory[i] / len;
		}

		if (Math.abs(frequency - avg) < 10 && self.targetTone !== frequency) {
			console.log(['tracking changed targetTone', self.targetTone, '->', frequency]);
			self.targetTone = frequency;
		}
	},

	drawTimeDomain : function (data, color, scaleFactor) {
		if (!scaleFactor) scaleFactor = 0.00003;

		var self = this;
		var w = self.historyCanvas.width, h = self.historyCanvas.height;

		var ctx = self.history2dContext;

		ctx.strokeStyle = color;
		ctx.beginPath();
		ctx.moveTo(0, h / 2);
		var unit = self.downSampleRate * scaleFactor;
		for (var i = 0, len = data.length; i < len; i++) {
			ctx.lineTo(i * unit, h - (data[i] * (h / 2) + (h / 2)));
		}
		ctx.stroke();
	},

	processDecode : function (unread) {
		/**
		 * 処理の流れ
		 * 
		 * 1. 2位相ロックインフィルタ(ローパスを含む)で対象周波数を直流化しノイズを除去
		 *    1. 対象周波数を位相を90度かえて別々に合成
		 *    2. それぞれにローパスにかける
		 *    3. 移動平均をとって突発的なパルスノイズを念のため除去する
		 *    3. 三平方の定理に従って合成しなおす
		 * 2. 2値化
		 *    1. 直近の min max から適当に閾値を算出
		 *    2. それに従って2値化
		 * 3. モールスのクロック検知
		 * 4. モールスのデコード
		 *    1. クロックを参照しながら . と - を合成していく
		 *    2. 符号表から文字にデコード
		 *
		 */
		var self = this;
		var DOWNSAMPLING_FACTOR2 = 4;

		var samples = self.samples;

		// 2位相ロックインフィルタ
		// ターゲットの周波数成分を直流化する
		var q = new Float32Array(samples.length);
		var p = new Float32Array(samples.length);
		var a    = samples.index, tone = self.downSampleRate / (2 * Math.PI * self.targetTone);
		for (var i = 0, len = samples.length; i < len; i++) {
			var nn = samples[(samples.length + samples.index - i) % samples.length];
			q[len - i] = Math.sin(a / tone) * nn;
			p[len - i] = Math.cos(a / tone) * nn;
			a--;
		}

		var filter = new IIRFilter2(DSP.LOWPASS, 20, 0, self.downSampleRate);
		filter.process(q);
		filter.process(p);

		// さらにダウンサンプリング
		var downSampledUnread = 0;
		for (var i = 0, x = 0, len = q.length; i < len; i += DOWNSAMPLING_FACTOR2, x++) {
			q[x] = q[i];
			p[x] = p[i];
			if (i < unread) {
				downSampledUnread++;
			}
		}
		q = q.subarray(0, x);
		p = p.subarray(0, x);

		// 移動平均
		var k = Math.floor(self.downSampleRate / 4 * 0.02), avgQ = 0, avgP = 0;
		for (var i = 0, len = p.length; i < len; i += 1) {
			avgQ -= (q[i - k] || 0) / k;
			avgQ += q[i] / k;
			avgP -= (p[i - k] || 0) / k;
			avgP += p[i] / k;

			q[i] = avgQ;
			p[i] = avgP;
		}

		// 位相計算 + min/max
		// p はもう使わないので破壊的に書いている
		var r = p, max = 0, min = Infinity;
		for (var i = 0, len = p.length; i < len; i += 1) {
			r[i] = Math.sqrt(q[i] * q[i] + p[i] * p[i]);
			if (max < r[i]) max = r[i];
			if (r[i] < min) min = r[i];
		}

		// 2値化
		var d = q;
		var mag = (min + max) / 2;
		for (var i = 0, len = r.length; i < len; i += 1) {
			d[i] = r[i] > mag ? 0.5 : 0;
		}

		// クロック検出
		// 最小の幅を毎回求め、移動平均する
		// 収束するまでちょっと時間がかかるのがよくない
		var lengths = [];
		for (var i = 0, st = 0, len = d.length; i < len; i++) {
			while (!d[i] && i < len) i++;
			if (i - st) lengths.push((i - st));
			st = i;
			while (d[i] && i < len) i++;
			if (i - st) lengths.push((i - st));
			st = i;
		}

		lengths.pop(); lengths.shift();

		self.clockHistory.push(Math.min.apply(null, lengths));
		self.clockHistory.shift();

		var clock = 0;
		for (var i = 0, len = self.clockHistory.length; i < len; i++) {
			clock += self.clockHistory[i] / len;
		}
		clock = Math.ceil(clock);

		// クロックレンダリング
		var clocks = new Float32Array(d.length);
		for (var i = 0, phase = 0, len = clocks.length; i < len; i++) {
			clocks[i] = phase;
			if (i % clock === 0) {
				phase = phase ? 0 : -0.5;
			}
		}
		self.drawTimeDomain(clocks, '#0000ff', 0.00003 * DOWNSAMPLING_FACTOR2 / 2);

		var ctx = self.history2dContext;
		ctx.font = "10px sans-serif";
		ctx.textBaseline = "bottom";
		ctx.textAlign = "left";
		ctx.fillStyle = '#00ff00';
		var clockSec = clock / (self.downSampleRate / DOWNSAMPLING_FACTOR2);
		ctx.fillText(clock + ' clock / ' + Math.round(clockSec * 1000) + ' msec', 0, self.historyCanvas.height);

		// モールスデコード
		var results = [];
		var remain = self.offset + downSampledUnread;
		var start = d.length - remain;
		for (var i = start, code = "", on = 0, off = 0, len = d.length; i < len; i++) {
			if (!d[i]) {
				if (on > clock * 2) {
					code += '-';
				} else
				if (on) {
					code += '.';
				}

				on = 0;
				off++;

				if (off > clock * 7) {
					// results.push(' ');
				} else
				if (off > clock * 3) {
					if (code) {
						self.offset = len - i;
						results.push({
							index: i - (3 * clock),
							char : Morse.reverse[code] || code
						});
						code = '';
					}
				}
			} else {
				off = 0;
				on++;
			}
		}

		if (!results.length) {
			self.offset = remain;
		}

		for (var i = 0, it; (it = self.decoded[i]); i++) {
			it.index -= downSampledUnread;
		}

		self.decoded = self.decoded.concat(results);

		var drawMap = {};
		for (var i = 0, it; (it = self.decoded[i]); i++) {
			drawMap[it.index] = it;
		}

		self.drawTimeDomain(r, '#ffffff');
		// self.drawTimeDomain(d, '#ff0000');

		(function (data, color, scaleFactor) {
			if (!scaleFactor) scaleFactor = 0.00003;

			var w = self.historyCanvas.width, h = self.historyCanvas.height;

			var ctx = self.history2dContext;

			var unit = self.downSampleRate * scaleFactor;

			ctx.font = "10px sans-serif";
			ctx.textBaseline = "top";
			ctx.textAlign = "right";
			ctx.fillStyle = '#ffffff';
			ctx.strokeStyle = color;

			var prevX = 0, prevY = h / 2;

			ctx.beginPath();
			ctx.strokeStyle = '#00cc00';
			ctx.moveTo(prevX, prevY);
			for (var i = 0, len = data.length - remain; i < len; i++) {
				prevX = i * unit; prevY = h - (data[i] * (h / 2) + (h / 2));
				ctx.lineTo(prevX, prevY);

			}
			ctx.stroke();

			ctx.beginPath();
			ctx.strokeStyle = '#00cccc';
			ctx.moveTo(prevX, prevY);
			for (var i = data.length - remain, len = data.length - downSampledUnread; i < len; i++) {
				prevX = i * unit; prevY = h - (data[i] * (h / 2) + (h / 2));
				ctx.lineTo(prevX, prevY);
			}
			ctx.stroke();

			ctx.beginPath();
			ctx.strokeStyle = '#ff0000';
			ctx.moveTo(prevX, prevY);
			for (var i = data.length - downSampledUnread, len = data.length; i < len; i++) {
				prevX = i * unit; prevY = h - (data[i] * (h / 2) + (h / 2));
				ctx.lineTo(prevX, prevY);
			}
			ctx.stroke();

			for (var i = 0, len = data.length; i < len; i++) {
				if (drawMap[i]) {
					var char = drawMap[i];
					ctx.fillText(char.char, i * unit, h / 2 + 20);
				}
			}
		})(d);
	},

	executeFFT : function () {
		var self = this;

		var samples = self.samples;
		var buffer  = self.fftBuffer;

		for (var i = 0, len = self.FFT_SIZE; i < len; i++) {
			var n = (samples.length + (samples.index - len) - i) % samples.length;
			// Hamming window function
			buffer[i] = (0.54 - 0.46 * Math.cos(2 * Math.PI * (i / len))) * samples[n];
		}
		self.FFT.forward(buffer);
	},

	drawSpectrum : function () {
		var self = this;

		var w = self.freqCanvas.width, h = self.freqCanvas.height;

		var ctx = self.freq2dContext;
		ctx.strokeStyle = '#ffffff';

		// console.log(['fftPeak', fft.getBandFrequency(fft.peakBand), 'fftPeak', fft.peak]);
		for (var i = 0, len = self.FFT.spectrum.length; i < len; i++) {
			// var m = fft.spectrum[i] * 10000;
			// dB
			var m = 20 * (Math.log(self.FFT.spectrum[i]) / Math.LN10);
			if (self.targetTone == self.FFT.getBandFrequency(i)) {
				ctx.fillStyle = '#ff0000';
			} else {
				ctx.fillStyle = '#ffffff';
			}
			ctx.fillRect(i, 0, 1, -m * (h / 100));
		}

		ctx.font = "10px sans-serif";
		ctx.textBaseline = "top";
		ctx.textAlign = "left";
		ctx.fillStyle = '#000000';
		for (var i = 1; i < 20; i += 2) {
			var hz = i * 100;
			ctx.fillText(hz + 'Hz', hz / self.FFT.bandwidth, 5);
		}

		ctx.font = "10px sans-serif";
		ctx.textBaseline = "bottom";
		ctx.textAlign = "left";
		ctx.fillStyle = '#ffffff';
		ctx.fillText('Target Tone: ' + Math.round(self.targetTone) + 'Hz', 0, h);
	},


	createDummy : function () {
		var self = this;

		var osc = self.context.createOscillator();
		var main = self.context.createScriptProcessor(8192, 1, 1);
		var gain = self.context.createGain();

		main.onaudioprocess = function (e) {
			var inputData = e.inputBuffer.getChannelData(0);
			var outputData = e.outputBuffer.getChannelData(0);
			for (var i = 0, len = inputData.length; i < len; i++) {
				var white = Math.random() * 2 - 1;
				outputData[i] = white * 1.5;
			}
		};

		(function () {
			var t = Math.random() * 3000;
			(function next () {
				setTimeout(function () {
					var code = '';
					for (var i = 0; i < 5; i++) {
						code += String.fromCharCode(65 + Math.random() * 25);
					}

					self.tone = self.context.sampleRate / (2 * Math.PI * 600);
					var source = self.context.createBufferSource();
					source.buffer = self.createToneBuffer(code);
					source.connect(gain);
					source.start(0);
					t = source.buffer.length / self.context.sampleRate * 1000;

					next();
				}, t + (1000));
			})();
		})();

		(function () {
			var t = Math.random() * 3000;
			(function next () {
				setTimeout(function () {
					var code = '';
					for (var i = 0; i < Math.random() * 10; i++) {
						code += String.fromCharCode(65 + Math.random() * 25);
					}

					self.tone = self.context.sampleRate / (2 * Math.PI * 400);
					var source = self.context.createBufferSource();
					source.buffer = self.createToneBuffer(code);
					source.connect(gain);
					source.start(0);
					t = source.buffer.length / self.context.sampleRate * 1000;

					next();
				}, t + (Math.random() * 1000));
			})();
		})();

		osc.connect(main);
		main.connect(gain);

		return gain;
	},

	play : function (code) {
		var self = this;

		var source = self.context.createBufferSource();
		source.buffer = self.createToneBuffer(code);
		source.connect(self.context.destination);
		source.start(0);

		var ret = new Deferred();
		setTimeout(function () {
			ret.call();
		}, source.buffer.length / self.context.sampleRate * 1000);
		return ret;
	},

	createToneBuffer : function (code) {
		var self = this;

		var sequence = [], length = 0;
		for (var i = 0, n, len = code.length; i < len; i++) {
			var c = code.charAt(i).toUpperCase();
			if (c == ' ') {
				n = 7 * self.config.word_spacing * self.unit;
				length += n;
				sequence.push(-n);
			} else {
				var m = Morse.codes[c];
				for (var j = 0, mlen = m.length; j < mlen; j++) {
					var mc = m.charAt(j);
					if (mc === '.') {
						n = 1 * self.unit;
						length += n;
						sequence.push(n);
					} else
					if (mc === '-') {
						n = 3 * self.unit;
						length += n;
						sequence.push(n);
					}
					if (j < mlen - 1) {
						n = 1 * self.config.character_spacing * self.unit;
						length += n;
						sequence.push(-n);
					}
				}
				n = 3 * self.config.word_spacing * self.unit;
				length += n;
				sequence.push(-n);
			}
		}
		length = Math.ceil(length);

		var buffer = self.context.createBuffer(1, Math.ceil(length), self.context.sampleRate);
		var data   = buffer.getChannelData(0);

		for (var i = 0, x = 0, len = sequence.length; i < len; i++) {
			var s = sequence[i];
			if (s < 0) {
				while (s++ < 0) {
					data[x++] = 0;
				}
			} else {
				for (var p = 0; p < s; p++) {
					data[x++] = Math.sin(p / self.tone);
				}
				// remove ticking (fade)
				for (var f = 0, e = self.context.sampleRate * 0.005; f < e; f++) {
					data[x - f] = data[x - f] * (f / e); 
				}
			}
		}

		return buffer;
	}
};

$(function () {
	var config = {
		tone : 600,
		character_spacing : 1.25,
		word_spacing: 2.5,
		wpm: 25
	};

	var decoder = new CWDecoder(config);

	setTimeout(function () {
		decoder.start();
	}, 1000);
});

