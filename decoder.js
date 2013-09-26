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

		self.logElement = $('#log');

		self.context = new AudioContext();

		// 4kHz 程度でサンプリングすれば十分カバーできるのでダウンサンプリングする
		self.DOWNSAMPLING_FACTOR = 10;
		self.SAMPLES_BUFFER_LENGTH = 10; // sec
		self.FFT_SIZE = 2048;

		// ローパスをかけたあとのダウンサンプリング
		self.DOWNSAMPLING_FACTOR2 = 4;

		self.downSampleRate     = self.context.sampleRate / self.DOWNSAMPLING_FACTOR;
		self.resultsSampleRate  = self.downSampleRate / self.DOWNSAMPLING_FACTOR2;
		self.log('downSampleRate: %s, resultsSampleRate: %s', self.downSampleRate, self.resultsSampleRate);

		self.lastSampledTime = 0;

		// 循環バッファ
		self.samples = new Float32Array(self.downSampleRate * self.SAMPLES_BUFFER_LENGTH);
		// 循環バッファ次に書きこむインデックス
		self.samples.index = 0;

		// processDecode
		self.q = new Float32Array(self.samples.length);
		self.p = new Float32Array(self.samples.length);
		self.lpf = new IIRFilter2(DSP.LOWPASS, 20, 0, self.downSampleRate);

		self.FFT = new FFT(self.FFT_SIZE, self.downSampleRate);
		self.fftOffset = 0;
		self.fftBuffer = new Float32Array(self.FFT_SIZE);
		self.spectrum = new Float32Array(self.FFT_SIZE / 2);
		self.log('FFT Band Width: %s', self.FFT.bandwidth);

		self.targetTone = 0;
		self.targetMode = 'auto';

		self.offset = 0;

		self.clockHistory = [];
		self.clock = Infinity;
		self.peakBandHistory = [];
		self.spectrumHistory = [];

		self.decoded = [];
		self.prev = {
			r : [],
			d : [],
			remain : 0,
			downSampledUnread: 0,
			time : 0
		};

		self.bindEvents();
		self.setConfig(config);
	},

	log : function (format) {
		var self = this;

		self.decodedTextElement = null;
		var args = Array.prototype.slice.call(arguments, 1);

		var text = format.replace(/%s/g, function () {
			return args.shift();
		});

		var log = $('<p/>').hide().text(text).show('fast');

		self.logElement.append(log);
		self.logElement.scrollTop(self.logElement[0].scrollHeight);
	},

	addChars : function (results) {
		var self = this;

		if (!self.decodedTextElement) {
			newLine();
		}

		for (var i = 0, it; (it = results[i]); i++) {
			if (it.char === '.-.-') {
				self.decodedTextElement.append(' ');
				self.decodedTextElement.append($('<span style="text-decoration: overline">AA</span>'));
				newLine();
				continue;
			}
			if (it.char === '=') {
				self.decodedTextElement.append('=');
				newLine();
				continue;
			}
			if (it.char === '+') {
				self.decodedTextElement.append('+');
				newLine();
				continue;
			}
			self.decodedTextElement.append(it.char);
		}

		self.logElement.scrollTop(self.logElement[0].scrollHeight);

		function newLine () {
			self.decodedTextElement = $('<p> >>> </p>').appendTo(self.logElement);
		}
	},

	bindEvents : function () {
		var self = this;

		$(self.freqCanvas).click(function (e) {
			var x = e.pageX - $(this).offset().left;
			self.targetTone = self.FFT.getBandFrequency(x);
			self.targetMode = 'fixed';
			self.resetDecodeData();
			self.log('Lock on targetTone: %s', self.targetTone);
		});
	},

	setConfig : function (config) {
		var self = this;
		self.config = config;
	},

	start : function () {
		var self = this;

		var useDummy = /dummy/.test(location.hash);
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
			if (/dummy-output/.test(location.hash)) {
				var gain = self.context.createGain();
				gain.gain.value = 0.5;
				dummy.connect(gain);
				gain.connect(self.context.destination);
			}
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
			self.lastSampledTime = new Date().getTime();
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

			self.executeFFT(unread);
			self.updateTargetTone();

			self.drawSpectrum();
			self.processDecode(unread);

			unread = 0;
		}, 200);

		setTimeout(function () {
			self.history2dContext.fillStyle = '#000000';
			self.history2dContext.fillRect(0, 0, self.historyCanvas.width, self.historyCanvas.width);
			self.drawWaveForm();

			// requestAnimationFrame(arguments.callee);
			setTimeout(arguments.callee, 200);
		}, 100);
	},

	resetDecodeData : function () {
		var self = this;
		self.decoded = [];
		self.clockHistory = [];
		self.clock = Infinity;
		self.offset  = self.resultsSampleRate * self.SAMPLES_BUFFER_LENGTH;
	},

	updateTargetTone : function () {
		var self = this;
		/**
		 * 最初は適当にピーク周波数をトラッキングする
		 *
		 */

		// TODO: 平均から離れて大きいほど選択されやすくなるようにしたい
		var frequency = self.FFT.getBandFrequency(self.peakBand);
		// 300Hz - 1200Hz 以外は無視する
		if (isNaN(frequency) || frequency < 300 || 1200 < frequency) {
			return;
		}

		self.peakBandHistory.push(frequency);
		while (self.peakBandHistory.length > 20) self.peakBandHistory.shift();

		var avg = 0;
		for (var i = 0, len = self.peakBandHistory.length; i < len; i++) {
			avg += self.peakBandHistory[i];
		}
		avg = avg / self.peakBandHistory.length;

		if (self.peakBandHistory.length < 3) return;

		if (!self.targetTone) {
			self.targetTone = avg;
			self.log('Initialized targetTone: %s', self.targetTone);
		}

		// ピークトーン・中心周波数をさがして動く
		var nearPeak = 0, nearPeakBand;
		for (var i = 0, len = 10; i < len; i++) {
			var index = Math.floor(Math.floor(self.targetTone / self.FFT.bandwidth) - (len / 2) + i);
			var n = self.spectrum[index] || 0;
			if (nearPeak < n) {
				nearPeak = n;
				nearPeakBand = index;
			}
		}
		nearPeakBand = self.FFT.getBandFrequency(nearPeakBand);

		if (nearPeakBand !== self.targetTone) {
			console.log('Tracking targetTone: %s -> %s', self.targetTone, nearPeakBand);
			self.targetTone = nearPeakBand;
			return;
		}

		if (self.targetMode === 'fixed') return;

		// ピーク周波数の移動平均と現在のピークが一定の差になったら対象周波数を変える
		if (Math.abs(frequency - avg) < 10 && self.targetTone !== frequency) {
			self.log('Changing targetTone: %s -> %s', self.targetTone, frequency);
			self.targetTone = frequency;
			self.resetDecodeData();
		}
	},

	drawWaveForm : function () {
		var self = this;
		var w = self.historyCanvas.width, h = self.historyCanvas.height;
		var ctx = self.history2dContext;
		var now = new Date().getTime();

		ctx.save();

		// 元
		var scale1 = w / self.samples.length;
		var step1  = Math.floor(1 / scale1);

		ctx.translate(-(self.downSampleRate * ((now - self.lastSampledTime) / 1000 )) * scale1, 0);
		ctx.beginPath();
		ctx.moveTo(w, h / 2);
		ctx.strokeStyle = '#333333';
		for (var i = 0, samples = self.samples, len = self.samples.length; i < len; i++) {
			var nn = samples[(samples.length + samples.index - i) % samples.length];
			ctx.lineTo(
				w - (i * scale1),
				h - (nn * (h / 2) + (h / 2))
			);
		}
		ctx.stroke();

		ctx.restore();

		ctx.save();

		var td = (now - self.prev.time) / 1000;
		var scale = w / self.prev.d.length;
		var tdSamples = self.resultsSampleRate * td;
		var step = Math.floor(1 / scale);

		ctx.fillStyle = '#333333';
		for (var i = 0; i < 10; i++) {
			var n = i * self.resultsSampleRate;
			ctx.fillRect(w - (n * scale), 0, 1, h);
		}

		ctx.translate(-tdSamples * scale, 0);

		function drawTimeDomain (data, color) {
			ctx.strokeStyle = color;
			ctx.beginPath();
			ctx.moveTo(0, h / 2);
			for (var i = 0, len = data.length; i < len; i++) {
				ctx.lineTo(i * scale, h - (data[i] * (h / 2) + (h / 2)));
			}
			ctx.stroke();
		}

		drawTimeDomain(self.prev.r, '#ffffff');

		// draw digital
		var data = self.prev.d;

		ctx.font = "10px sans-serif";
		ctx.textBaseline = "top";
		ctx.textAlign = "right";
		ctx.fillStyle = '#ffffff';

		var prevX = 0, prevY = h / 2;

		ctx.beginPath();
		ctx.strokeStyle = '#00cc00';
		ctx.moveTo(prevX * scale, prevY);
		for (var i = 0, len = data.length - self.prev.remain; i < len; i += step) {
			prevX = i; prevY = h - (data[i] * (h / 2) + (h / 2));
			ctx.lineTo(prevX * scale, prevY);
		}
		ctx.stroke();

		ctx.beginPath();
		ctx.strokeStyle = '#00cccc';
		ctx.moveTo(prevX * scale, prevY);
		for (var i = data.length - self.prev.remain, len = data.length - self.prev.downSampledUnread; i < len; i += step) {
			prevX = i; prevY = h - (data[i] * (h / 2) + (h / 2));
			ctx.lineTo(prevX * scale, prevY);
		}
		ctx.stroke();

		ctx.beginPath();
		ctx.strokeStyle = '#ff0000';
		ctx.moveTo(prevX * scale, prevY);
		for (var i = data.length - self.prev.downSampledUnread, len = data.length; i < len; i += step) {
			prevX = i; prevY = h - (data[i] * (h / 2) + (h / 2));
			ctx.lineTo(prevX * scale, prevY);
		}
		ctx.stroke();

		// draw clocks
		var clocks = new Float32Array(self.prev.d.length);
		for (var i = 0, phase = 0, len = clocks.length; i < len; i++) {
			clocks[i] = phase;
			if (i % self.clock === 0) {
				phase = phase ? 0 : -0.5;
			}
		}
		drawTimeDomain(clocks, '#0000ff');

		// draw chars
		var drawMap = {};
		for (var i = 0, it; (it = self.decoded[i]); i++) {
			drawMap[it.index] = it;
		}

		for (var i = 0, len = data.length; i < len; i++) {
			if (drawMap[i]) {
				var char = drawMap[i];
				ctx.fillText(char.char, i * scale, h / 2 + 20);
			}
		}

		ctx.restore();

		ctx.font = "10px sans-serif";
		ctx.textBaseline = "bottom";
		ctx.textAlign = "left";
		ctx.fillStyle = '#00ff00';
		var clockSec = self.clock / (self.downSampleRate / self.DOWNSAMPLING_FACTOR2);
		var cpm = Math.round(6000 / (clockSec * 1.3 *  1000));
		var wpm = Math.round(cpm / 5);
		ctx.fillText(
			self.clock + ' clock / ' + Math.round(clockSec * 1000) + ' msec / ' + wpm + ' wpm / ' + cpm + ' cpm',
			0, 
			self.historyCanvas.height
		);
	},

	processDecode : function (unread) {
		/**
		 * 処理の流れ
		 * 
		 * 1. 2位相ロックインフィルタ(ローパスを含む)で対象周波数を直流化しノイズを除去
		 *    1. 対象周波数を位相を90度かえて別々に合成
		 *    2. それぞれにローパスにかける
		 *    3. 2位相を三平方の定理に従って合成しなおす
		 * 2. 2値化
		 *    1. 直近の min max から適当に閾値を算出
		 *    2. それに従って2値化
		 * 3. モールスのクロック検知
		 *    1. 0/1 の間隔で一番小さいものをクロックとする
		 * 4. モールスのデコード
		 *    1. クロックを参照しながら . と - を合成していく
		 *       クロックの2倍以上の長さなら長点扱いにする。
		 *    2. 符号表から文字にデコード
		 *
		 */
		var self = this;

		var samples = self.samples;

		// 2位相ロックインフィルタ
		// ターゲットの周波数成分を直流化する
		var q = self.q;
		var p = self.p;
		var tone = self.downSampleRate / (2 * Math.PI * self.targetTone);
		for (var i = 0, a = samples.index, len = samples.length; i < len; i++) {
			var nn = samples[(samples.length + samples.index - i) % samples.length];
			q[len - i] = (Math.sin(a / tone) > 0 ? 1 : -1) * nn;
			p[len - i] = (Math.cos(a / tone) > 0 ? 1 : -1) * nn;
			a--;
		}

		self.lpf.process(q);
		self.lpf.process(p);

		// さらにダウンサンプリング
		var downSampledUnread = 0;
		for (var i = 0, x = 0, len = q.length; i < len; i += self.DOWNSAMPLING_FACTOR2, x++) {
			q[x] = q[i];
			p[x] = p[i];
			if (i < unread) {
				downSampledUnread++;
			}
		}
		q = q.subarray(0, x);
		p = p.subarray(0, x);

		// 移動平均
//		var k = Math.floor(self.downSampleRate / 4 * 0.01), avgQ = 0, avgP = 0;
//		for (var i = 0, len = p.length; i < len; i += 1) {
//			avgQ -= (q[i - k] || 0) / k;
//			avgQ += q[i] / k;
//			avgP -= (p[i - k] || 0) / k;
//			avgP += p[i] / k;
//
//			q[i] = avgQ;
//			p[i] = avgP;
//		}

		// 振幅計算 + min/max
		// p はもう使わないので破壊的に書いている
		var r = p, max = 0, min = Infinity;
		for (var i = 0, len = p.length; i < len; i += 1) {
			var m = Math.sqrt(q[i] * q[i] + p[i] * p[i]); // 振幅
			// var pha = q[i] > 0 ? Math.atan2(p[i], q[i]) : Math.atan2(p[i], q[i]) + Math.PI; // 位相
			r[i] = m;
			if (i > len - 3000) {
				if (max < r[i]) max = r[i];
				if (r[i] < min) min = r[i];
			}
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
		while (self.clockHistory.length > 5) self.clockHistory.shift();

		var clock = 0;
		for (var i = 0, len = self.clockHistory.length; i < len; i++) {
			clock += self.clockHistory[i];
		}
		self.clock = Math.ceil(clock / len);
		if (self.clock < 25) self.clock = 25;

		var remain = self.offset + downSampledUnread;
		var results = [];

		if (self.clockHistory.length >= 5) {
			// モールスデコード
			var start = d.length - remain;
			if (start < 0) start = 0;
			for (var i = start, code = "", on = 0, off = 0, len = d.length; i < len; i++) {
				if (!d[i]) {
					if (on > self.clock * 2) {
						code += '-';
					} else
					if (on) {
						code += '.';
					}

					on = 0;
					off++;

					if (off > self.clock * 8) {
						results.push({
							index: -1,
							char : ' '
						});
					} else
					if (off > self.clock * 3) {
						if (code) {
							self.offset = len - i;
							results.push({
								index: i - (3 * self.clock),
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
		}

		if (!results.length) {
			self.offset = remain;
		}

		for (var i = 0, it; (it = self.decoded[i]); i++) {
			it.index -= downSampledUnread;
		}

		self.addChars(results);

		self.decoded = self.decoded.concat(results);
		for (var i = 0, it; (it = self.decoded[i]); i++) {
			if (it.char === ' ' && (self.decoded[i-1] || {}).char === ' ') {
				self.decoded.splice(i--, 1);
			}
		}

		while (self.decoded.length > 1000) self.decoded.shift();

		self.prev.r = r;
		self.prev.d = d;
		self.prev.remain = remain;
		self.prev.downSampledUnread = downSampledUnread;
		self.prev.time = new Date().getTime();
	},

	executeFFT : function (unread) {
		var self = this;

		var samples = self.samples;
		var buffer  = self.fftBuffer;

		var remainSamples = unread - self.fftOffset;
		var startIndex    = (samples.length + (samples.index - remainSamples)) % samples.length;

		// console.log(['remainSamples', remainSamples, 'startIndex', startIndex]);

		for (var r = 0; r < remainSamples; r += self.FFT_SIZE) {
			for (var i = 0, len = self.FFT_SIZE; i < len; i++) {
				var n = (startIndex + r + i) % samples.length;

				// Hann window function
				buffer[i] = (0.5 * (1 - Math.cos( (2 * Math.PI * i) / (len - 1) )) ) * samples[n];

				// Hamming window function
				// buffer[i] = (0.54 - 0.46 * Math.cos( (2 * Math.PI * i) / (len - 1) )) * samples[n];

//				// Flat top window function
//				buffer[i] = (
//					1 -
//					1.93  * Math.cos( (2 * Math.PI * i) / (len - 1) ) +
//					1.29  * Math.cos( (4 * Math.PI * i) / (len - 1) ) -
//					0.388 * Math.cos( (6 * Math.PI * i) / (len - 1) ) +
//					0.028 * Math.cos( (8 * Math.PI * i) / (len - 1) )
//				) * samples[n];
			}
			self.FFT.forward(buffer);

			self.spectrumHistory.push(new Float32Array(self.FFT.spectrum));
			while (self.spectrumHistory.length > 20) self.spectrumHistory.shift();
		}

		var peak = 0, peakBand;
		for (var i = 0, len = self.spectrum.length; i < len; i++) {
			var sum = 0;
			for (var j = 0, it; (it = self.spectrumHistory[j]); j++) {
				sum += it[i];
			}
			var avg = sum / self.spectrumHistory.length;
			self.spectrum[i] = avg;
			if (avg > peak) {
				peakBand = i;
				peak = avg;
			}
		}

		self.peakBand = peakBand;
		self.peak = peak;
	},

	drawSpectrum : function () {
		var self = this;

		var w = self.freqCanvas.width, h = self.freqCanvas.height;

		var ctx = self.freq2dContext;
		ctx.strokeStyle = '#ffffff';

		var factor = 100;

		ctx.fillStyle = '#000000';
		ctx.fillRect(0, 0, w, h);

		ctx.fillStyle = '#ff0000';
		ctx.fillRect(Math.floor(self.targetTone / self.FFT.bandwidth), 0, 1, h);

		ctx.beginPath();
		ctx.fillStyle = '#cccccc';
		ctx.moveTo(0, 0);
		for (var i = 0, len = self.FFT.spectrum.length; i < len; i++) {
			// dB
			var m = 20 * (Math.log(self.FFT.spectrum[i]) / Math.LN10); // no warnings
			// ctx.fillRect(i, 0, 1, -m * (h / factor));
			ctx.lineTo(i, -m * (h / factor));
		}
		ctx.lineTo(w, 0);
		ctx.closePath();
		ctx.fill();

		// console.log(['fftPeak', fft.getBandFrequency(fft.peakBand), 'fftPeak', fft.peak]);
		ctx.beginPath();
		ctx.fillStyle = '#ffffff';
		ctx.moveTo(0, 0);
		for (var i = 0, len = self.spectrum.length; i < len; i++) {
			// dB
			var m = 20 * (Math.log(self.spectrum[i]) / Math.LN10); // no warnings
			// ctx.fillRect(i, 0, 1, -m * (h / factor));
			ctx.lineTo(i, -m * (h / factor));
		}
		ctx.lineTo(w, 0);
		ctx.closePath();
		ctx.fill();

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
		ctx.fillText('Target Tone: ' + Math.round(self.targetTone) + 'Hz' + (self.targetMode == 'fixed' ? ' [Locked]' : ''), 0, h);
	},


	createDummy : function () {
		var self = this;

		var osc  = self.context.createOscillator();
		var main = self.context.createScriptProcessor(8192, 1, 1);
		var gain = self.context.createGain();
		gain.gain.value = 0.3;

		main.onaudioprocess = function (e) {
			var inputData = e.inputBuffer.getChannelData(0);
			var outputData = e.outputBuffer.getChannelData(0);
			for (var i = 0, len = inputData.length; i < len; i++) {
				var white = (Math.sqrt(-2 * Math.log(Math.random())) * Math.sin(2 * Math.PI * Math.random())) * 2 + 0;
				outputData[i] = white;
			}
			main.onaudioprocess = arguments.callee;
		};

		(function () {
			var t = Math.random() * 3000;
			(function next () {
				setTimeout(function () {
					var code = '';
					for (var i = 0; i < Math.random() * 10; i++) {
						code += String.fromCharCode(65 + Math.random() * 25);
					}

					var source = self.context.createBufferSource();
					source.buffer = self.createToneBuffer(code, {
						character_spacing: 1,
						word_spacing: 1,
						tone : 400,
						wpm: 25
					});
					source.connect(gain);
					source.start(0);
					t = source.buffer.length / self.context.sampleRate * 1000;

					next();
				}, t + (Math.random() * 1000));
			})();
		})();

		(function () {
			var t = Math.random() * 3000;
			var seq = [
				// http://homepage2.nifty.com/7m1lot/rs_doc_1.htm
				'CQ CQ CQ DE JH1UMV JH1UMV JH1UMV PSE +',
				'CQ CQ CQ DE JH1UMV JH1UMV JH1UMV PSE +',
				'JH1UMV DE 7M4VJZ 7M4VJZ +',
				'7M4VJZ DE JH1UMV GM OM TNX FER CALL UR RST 599 5NN HR IN YOKOHAMA ? YOKOHAMA CITY ES NAME IS HIRO HIRO HW ? + 7M4VJZ DE JH1UMV K',
				'JH1UMV DE 7M4VJZ GM DR HIRO OM TNX FER CMG BCK ES RPRT 599 FRM YOKOHAMA CITY UR ALSO 599 5NN HR IN MACHIDA ? MACHIDA CITY ES NAME TARO ? TARO HW ?',
				'7M4VJZ DE JH1UMV DR TARO SAN CPI ALL = HR WX RAINY ES TEMP 15 C = WL QSL VIA BURO HW ? + 7M4VJZ DE JH1UMV K',
				'DR HIRO TNX FER FB QSO HPE CUAGN SOON NW UR NICE DX + 7M4VJZ DE JH1UMV/1 K',
				'DR HIRO 73 TU $ E E'
			];
			var i = 0;

			(function next () {
				setTimeout(function () {
					var code = seq[i++ % seq.length];

					var source = self.context.createBufferSource();
					source.buffer = self.createToneBuffer(code, {
						character_spacing: 1,
						word_spacing: 1,
						tone : 600,
						wpm: 25
					});
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

					self.unit  = self.context.sampleRate * (35 / 1000);
					self.tone = self.context.sampleRate / (2 * Math.PI * 800);
					var source = self.context.createBufferSource();
					source.buffer = self.createToneBuffer(code, {
						character_spacing: 1,
						word_spacing: 1,
						tone : 800,
						wpm: 30
					});
					source.connect(gain);
					source.start(0);
					t = source.buffer.length / self.context.sampleRate * 1000;

					next();
				}, t + (Math.random() * 1000));
			})();
		})();

		(function () {
			var t = Math.random() * 3000;
			(function next () {
				setTimeout(function () {
					var code = '';
					for (var i = 0; i < 5; i++) {
						code += String.fromCharCode(65 + Math.random() * 25);
					}

					self.unit  = self.context.sampleRate * (100 / 1000);
					self.tone = self.context.sampleRate / (2 * Math.PI * 900);
					var source = self.context.createBufferSource();
					source.buffer = self.createToneBuffer(code, {
						character_spacing: 1,
						word_spacing: 1,
						tone : 900,
						wpm: 15
					});
					source.connect(gain);
					source.start(0);
					t = source.buffer.length / self.context.sampleRate * 1000;

					next();
				}, t + (1000));
			})();
		})();

		osc.connect(main);
		main.connect(gain);

		return gain;
	},

	play : function (code) {
		var self = this;

		var source = self.context.createBufferSource();
		source.buffer = self.createToneBuffer(code, self.config);
		source.connect(self.context.destination);
		source.start(0);

		var ret = new Deferred();
		setTimeout(function () {
			ret.call();
		}, source.buffer.length / self.context.sampleRate * 1000);
		return ret;
	},

	createToneBuffer : function (code, config) {
		var self = this;

		var speed = 
			config.cpm ? 6000 / config.cpm:
			config.wpm ? 1200 / config.wpm:
				50;
		var unit = self.context.sampleRate * (speed / 1000);
		var tone = self.context.sampleRate / (2 * Math.PI * config.tone);

		var sequence = [], length = 0;
		for (var i = 0, n, len = code.length; i < len; i++) {
			var c = code.charAt(i).toUpperCase();
			if (c == ' ') {
				n = 7 * config.word_spacing * unit;
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
						n = 1 * config.character_spacing * unit;
						length += n;
						sequence.push(-n);
					}
				}
				n = 3 * self.config.character_spacing * unit;
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
					data[x++] = Math.sin(p / tone);
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

