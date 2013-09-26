Deferred.define();

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


KochMethod = function () { this.init.apply(this, arguments) };
KochMethod.prototype = {
	chars : "KMURESNAPTLWI.JZ=FOY,VG5/Q92H38B?47C1D60X",

	init : function (config) {
		var self = this;

		self.context = new AudioContext();
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
	},

	start : function (callback) {
		var self = this;
		var config = self.config;

		var end = new Date().getTime() + config.time * 1000;

		return next(function main () {
			if (new Date() > end) return;

			var code = '';
			var len = Math.floor((config.word[1] - config.word[0]) * Math.random()) + config.word[0];
			for (var i = 0; i < len; i++) {
				var char = self.chars.charAt(Math.floor((config.level + 1) * Math.random()));
				code += char;
			}

			return self.play(code).next(function () {
				callback(code);
			}).
			wait((self.speed * 7 * self.config.word_spacing) / 1000).
			next(main);
		});
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

	playSuccess : function () {
		var self = this;

		var length = self.context.sampleRate * 0.7;
		var buffer = self.context.createBuffer(1, length, self.context.sampleRate);
		var data   = buffer.getChannelData(0);

		var tone = self.context.sampleRate / (2 * Math.PI * 1000);
		for (var i = 0, len = data.length; i < len; i++) {
			if (i == Math.floor(len * 0.1)) {
				tone = tone / 2;
			}
			var v = Math.sin(i / tone);
			data[i] = (v < 0 ? -1 : 1) * ((len - i) / len);
		}

		var gain = self.context.createGain();
		gain.gain.value = 0.1;
		gain.connect(self.context.destination);

		var source = self.context.createBufferSource();
		source.buffer = buffer;
		source.connect(gain);
		source.start(0);
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
						n = 1 * self.unit;
						length += n;
						sequence.push(-n);
					}
				}
				n = 3 * self.config.character_spacing * self.unit;
				length += n;
				sequence.push(-n);
			}
		}
		length = Math.ceil(length);

		console.log(['createBuffer', length, self.context.sampleRate]);
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
					data[x++] = Math.sin(p / self.tone) * 0.6;
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


	var $buttons        = $('#buttons').hide();
	var $start          = $('#start');
	var $answer         = $('#answer');
	var $answerInput    = $('#answer-input');
	var $answerAnswer   = $('#answer-answer');
	var $answerAccuracy = $('#answer-accuracy');
	var $elapsed        = $('#elapsed');
	var $levelup        = $('#levelup');
	var $input          = $('#input');

	var config = {
		level: +location.search.substring(1) || 2,
		word : [5, 5], // 5~5 chars
		character_spacing : 2,
		word_spacing: 2.0,
		tone: 600,
		// time: 10, // sec
		time: 60, // sec
		wpm: 22
	};

	var koch = new KochMethod(config);

	$start.val('Start (Level:' + config.level + ')');
	$levelup.attr('href', '?' + (config.level + 1));

//	// CAPS LOCK
//	$input.keyup(function (e) {
//		var cursor = this.selectionStart;
//		this.value = this.value.toUpperCase();
//		this.selectionStart = cursor;
//		this.selectionEnd = cursor;
//	}).hide();

	$start.click(function () {
		$buttons.show();
		$answer.hide();
		$answerInput.empty();
		$answerAnswer.empty();
		$input.val('').show().focus();
		$start.attr('disabled', 'disabled');

		setTimeout(function () {
			var start = new Date();
			var timer = setInterval(function () {
				$elapsed.text( Math.floor((new Date() - start) / 1000) );
			}, 1000);

			var answers = [];

			koch.start(function (answer) {
				answers.push(answer);
			}).
			next(function () {
				clearInterval(timer);
				return wait(3);
			}).
			next(function () {
				$input.hide();
				var inputs = $input.val().split(/\s+/);

				var inputsJoined = inputs.join("\n").replace(/^\s+|\s+$/g, '').toUpperCase();
				var answersJoined = answers.join("\n");

				var dmp = new diff_match_patch();
				var diffs = dmp.diff_main(inputsJoined, answersJoined);

				var $i = $('<div/>');
				var $a = $('<div/>');

				for (var i = 0, it; (it = diffs[i]); i++) {
					if (it[0] === 0) {
						$i.append(it[1]);
						$a.append(it[1]);
					} else
					if (it[0] === -1) {
						$('<span class="delete"/>').text(it[1]).appendTo($a);
					} else
					if (it[0] === 1) {
						$('<span class="insert"/>').text(it[1]).appendTo($i);
					}
				}

				$answerInput.append($i);
				$answerAnswer.append($a);

				var distanse  = dmp.diff_levenshtein(diffs);
				var wrongRate = distanse / answersJoined.replace(/\s+/g, '').length;
				var accuracy  = (1 - wrongRate) * 100;


				$answerAccuracy.text(accuracy.toFixed(1) + '%');
				if (accuracy >= 90) {
					$answerAccuracy.addClass('success');
				} else {
					$answerAccuracy.removeClass('success');
				}

				$answer.show();
				$buttons.hide();
				$start.removeAttr('disabled');
			}).
			error(function (e) {
				alert(e);
			});
		}, 3000);
	});

	$buttons.on('touchstart click', function (e) {
		if (e.target.value) {
			$input.val($input.val() + e.target.value);
		}
	});

	$('#speed').change(function () {
		var wpm = +$(this).val();
		var cpm = wpm * 5;

		koch.config.wpm = wpm;
		koch.setConfig(koch.config);

		localStorage.wpm = wpm;

		$('#speed-label').text(
			wpm + 'wpm ' + 
			cpm + 'cpm'
		);
	}).val(localStorage.wpm || 20).change();

	$('#character-spacing').change(function () {
		var val = +$(this).val();

		koch.config.character_spacing = val;
		koch.setConfig(koch.config);
		localStorage.character_spacing = val;

		$('#character-spacing-label').text('x' + val.toFixed(1));
	}).val(localStorage.character_spacing || 2.0).change();

	$('#word-spacing').change(function () {
		var val = +$(this).val();

		koch.config.word_spacing = val;
		koch.setConfig(koch.config);
		localStorage.word_spacing = val;

		$('#word-spacing-label').text('x' + val.toFixed(1));
	}).val(localStorage.word_spacing || 2.0).change();

	$('#tone').change(function () {
		var val = +$(this).val();

		koch.config.tone = val;
		koch.setConfig(koch.config);
		localStorage.tone = val;

		$('#tone-label').text(val + 'Hz');
	}).val(localStorage.tone || 600).change();

	window.play = function (chars) {
		koch.play(chars);
	};
	// play(Array(100).join('.').replace(/./g, function () { return Math.random() > 0.5 ? 'K' : 'R' }).split(/(.....)/).join(' '));
});
