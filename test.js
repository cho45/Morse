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
	wpm  : 22,

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
		self.speed = 1200 / self.wpm;
		console.log(['speed', self.speed]);

		self.config = {
			character_spacing : 1.25,
			word_spacing: 2.0,
			tone: 600
		};

		self.tone = self.context.sampleRate / (2 * Math.PI * self.config.tone);
		self.unit  = self.context.sampleRate * (self.speed / 1000);
	},

//	start : function (code) {
//		var self = this;
//
//		var unit = self.speed / 1000;
//		var time = self.context.currentTime;
//
//		for (var i = 0, len = code.length; i < len; i++) {
//			var char = code.charAt(i);
//
//			if (char == ' ') {
//				time += unit * 6;
//				continue;
//			}
//
//			var morse = Training.codes[char];
//			for (var j = 0, jlen = morse.length; j < jlen; j++) {
//				var c = morse.charAt(j);
//				var osc = self.context.createOscillator();
//				osc.detune.value = 5;
//				if (c == '.') {
//					osc.frequency.value = 600;
//					osc.start(time);
//					time += unit;
//					osc.stop(time);
//					time += unit;
//				} else
//				if (c == '-') {
//					osc.frequency.value = 600;
//					osc.start(time);
//					time += unit * 3;
//					osc.stop(time);
//					time += unit;
//				}
//				osc.connect(self.context.destination);
//			}
//			time += unit * 2;
//		}
//		var ret = new Deferred();
//		setTimeout(function () {
//			ret.call();
//		}, (time - self.context.currentTime) * 1000);
//
//		return ret;
//	},
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

	var $answer = $('#a');

	var chars = "KMURESNAPTLWI.JZ=FOY,VG5/Q92H38B?47C1D60X";
	var words = [
		"CQ",
		"DX",
		"DE",
		"PSE",
		"599",
		"73",
		"5NN",
		"TU",  // thank you
		"BK", // break
		"GM", // good morning
		"GA", // good afternoon
		"GE", // good evening
		"OM",
		"TNK",
		"TNX",
		"FER",// for
		"CALL",
		"UR", // your
		"SIG",
		"IS",
		"RST", // 
		"FB",
		"MI", // var
		"MY",
		"HW?", // How?
		"ES", // and
		"CMG", // comming
		"ALSO",
		"IN",
		"CPI", // copy
		"COPI", // copy
		"WL", // well
		"FRM", // from
		"NR", // near
		"DR", // dear
		"FINE",
		"CLOUDY",
		"RAINY",
		"TEMP",
		"VIA",
		"BURO",
		"RIG",
		"ANT",
		"GP",
		"WATTS",
		"HPE", // hope
		"CUAGN", // see you again
		"SOON",
		"CL", // close
		"BECUZ", // because
		"LTR", // letter

//		"GO",
//		"AM",
//		"ME",
//		"ON",
//		"BY",
//		"TO",
//		"UP",
//		"SO",
//		"IT",
//		"NO",
//		"OF",
//		"AS",
//		"HE",
//		"IF",
//		"AN",
//		"US",
//		"OR",
//		"IN",
//		"IS",
//		"AT",
//		"VAR",
//		"WE",
//		"DO",
//		"BE",
//		"AND",
//		"MAN",
//		"HIM",
//		"OUT",
//		"NOT",
//		"BUT",
//		"CAN",
//		"WHO",
//		"HAS",
//		"MAY",
//		"WAS",
//		"ONE",
//		"SHE",
//		"ALL",
//		"YOU",
//		"HOW",
//		"ANY",
//		"ITS",
//		"SAY",
//		"ARE",
//		"NOW",
//		"TWO",
//		"FOR",
//		"MEN",
//		"HER",
//		"HAD",
//		"THE",
//		"OUR",
//		"HIS",
//		"BEEN",
//		"SOME",
//		"THEN",
//		"LIKE",
//		"WELL",
//		"MADE",
//		"WHEN",
//		"HAVE",
//		"ONLY",
//		"YOUR",
//		"WORK",
//		"OVER",
//		"SUCH",
//		"TIME",
//		"WERE",
//		"WITH",
//		"INTO",
//		"VERY",
//		"WHAT",
//		"THEN",
//		"MORE",
//		"WILL",
//		"THEY",
//		"COME",
//		"THAT",
//		"FROM",
//		"MUST",
//		"SAID",
//		"THEM",
//		"THIS",
//		"UPON",
//		"GREAT",
//		"ABOUT",
//		"OTHER",
//		"SHALL",
//		"EVERY",
//		"THESE",
//		"FIRST",
//		"THEIR",
//		"COULD",
//		"WHICH",
//		"WOULD",
//		"THERE",
//		"BEFORE",
//		"SHOULD",
//		"LITTLE",
//		"PEOPLE",

		"QTH", // 常置場所
		"QRS",
		"QSO",
		"QSL",
		"QRM",
		"QSB",
		"QSY",
		"QRL",  // 使用中です
		"QRL?", // 使用中ですか?
		"QRZ"
	];

	wait(1).
	next(function main () {
		var code;
		if (Math.random() < 0.2) {
			var char = chars.charAt(Math.floor(chars.length * Math.random()));
			code = Array(12).join(char + ' ');
			$answer.text(char);
		} else {
			code = words[Math.floor(words.length * Math.random())];
			$answer.text(code);
			code = Array(12).join(code + ' ');
		}


		return Training.play(code).next(function () {
			$answer.text('');
			return wait(0.5);
		}).
		next(main);
	}).
	error(function (e) {
		alert(e);
	});

});
