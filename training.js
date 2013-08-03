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


Training = {
	cpm  : 110,
	tone : 600, // Hz

	codes : {
		"A":".-",
		"B":"-...",
		"C":"-.-.",
		"D":"-..",
		"E":".",
		"F":"..-.",
		"G":"--.",
		"H":"....",
		"I":"..",
		"J":".---",
		"K":"-.-",
		"L":".-..",
		"M":"--",
		"N":"-.",
		"O":"---",
		"P":".--.",
		"Q":"--.-",
		"R":".-.",
		"S":"...",
		"T":"-",
		"U":"..-",
		"V":"...-",
		"W":".--",
		"X":"-..-",
		"Y":"-.--",
		"Z":"--..",
		"0":"-----",
		"1":".----",
		"2":"..---",
		"3":"...--",
		"4":"....-",
		"5":".....",
		"6":"-....",
		"7":"--...",
		"8":"---..",
		"9":"----.",
		".":".-.-.-",
		",":"--..--",
		"?":"..--..",
		"'":".----.",
		"!":"-.-.--",
		"/":"-..-.",
		"(":"-.--.",
		")":"-.--.-",
		"&":".-...",
		":":"---...",
		";":"-.-.-.",
		"=":"-...-",
		"+":".-.-.",
		"-":"-....-",
		"_":"..--.-",
		"\"":".-..-.",
		"$":"...-..-",
		"@":".--.-."
	},

	init : function () {
		var self = this;

		self.context = new AudioContext();
		self.speed = 6000 / self.cpm;
		console.log(['speed', self.speed]);

		self.tone = self.context.sampleRate / (2 * Math.PI * Training.tone);
		self.unit = self.context.sampleRate * (Training.speed / 1000);
	},

	start : function (code) {
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

	success : function () {
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

	createToneString : function (code) {
		return code.replace(/./g, function (_) {
			if (_ == ' ') {
				return '000000';
			} else {
				return Training.codes[_].replace(/./g, function (_) {
					return _ == '-' ? '1110' : '10';
				}) + '00';
			}
		});
	},

	createToneBuffer : function (code) {
		var self = this;
		code = self.createToneString(code);

		var length = code.length * self.unit;
		console.log(['createBuffer', length, self.context.sampleRate]);
		var buffer = self.context.createBuffer(1, length, self.context.sampleRate);
		var data   = buffer.getChannelData(0);

		for (var x = 0, i = 0, len = code.length; i < len; i++) {
			var c = +code.charAt(i);
			for (var u = 0; u < self.unit; u++) {
				data[x++] = Math.sin(x / self.tone) * c;
			}
		}
		return buffer;
	}
};

$(function () {

	var input = function () {
		var d = null;
		$('.buttons').on('touchstart click', function (e) {
			if (d) {
				d.call(e.target.value);
				d = null;
			}
		});

		return function () {
			d = new Deferred();
			return d;
		};
	} ();


	Training.init();
	Training.success();

	var $answer = $('#a');
	var $levelUp = $('#level').hide();
	var $score = $('#score');
	var $nomiss = $('#nomiss');
	var $level = $('#level');

	var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,?'!/()&:;=+-_\"$@";
	var level = 36;
	var score = 0;
	var nomiss = 0;
	var stats = JSON.parse(localStorage.stats || "{}") || {};
	var start = new Date();

	$score.text(score);

	wait(3).
	next(function me () {
		var char;
		if (level > chars.length) level = chars.length;

		var targets = chars.substring(0, level);
		char = targets.charAt(Math.floor(targets.length * Math.random()));

		loop(3, function () {
			var qtime = new Date();
			return Training.start(char).next(function () {
				$answer.removeClass('success');
				$answer.text('?');
				return Deferred.earlier([
					wait(1).next(function () {
						nomiss = 0;
						score--;
					}),
					input().next(function (i) {
						if (char == i) {
							var time = new Date() - qtime;
							Training.success();
							if (!stats[char]) stats[char] = { count: 0, time : +Infinity };
							stats[char].count++;
							if (time < stats[char].time) {
								stats[char].time = time;
							}
							nomiss++;
							score++;
							$answer.addClass('success');
						} else {
							nomiss = 0;
							score -= 3;
						}
					})
				]);
			}).
			next(function () {
				if (score < 0) score = 0;
				$score.text(score);
//				level = Math.floor(score / 10) + 2;
//				$level.text(level);

				localStorage.stats = JSON.stringify(stats);

				if (nomiss) {
					$nomiss.text('No miss: ' + nomiss);
				}

				$answer.text(char);
				return wait(0.5);
			}).
			next(function () {
				$answer.text('');
				return wait(0.5);
			});
		}).
		next(me);
	}).
	error(function (e) {
		alert(e);
	});

	$levelUp.click(function () {
		level++;
		location.hash = '#' + level;
		$levelUp.val('Level Up (' + level + ')');
	});

});
