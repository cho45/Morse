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


Trainer = function () { this.init.apply(this, arguments) };
Trainer.prototype = {
	init : function (config) {
		var self = this;

		self.context = new AudioContext();
		self.config = config;
	},

	start : function (callback) {
		var self = this;
		var config = self.config;

		var seq = Trainer.TYPES[self.config.type];
		var time = self.context.currentTime;


		// pre-loading time: ensure to output audio
		var osc  = self.context.createOscillator();
		var gain = self.context.createGain();
		gain.gain.value = 0;
		osc.connect(gain);
		gain.connect(self.context.destination);

		osc.start(time);
		time += 3;
		osc.stop(time);

		var end  = time + config.time;
		if (location.hash === '#debug') end = time + 5;

		return next(function () {
			var code = seq.next();

			var source = self.context.createBufferSource();
			source.buffer = self.createToneBuffer(code + ' ', self.config);
			source.connect(self.context.destination);
			source.start(time);

			setTimeout(function () {
				callback(code);
			}, (time - self.context.currentTime) * 1000);

			var lengthOfSequence = source.buffer.length / self.context.sampleRate;
			time += lengthOfSequence;

			if (time < end) {
				return next(arguments.callee);
			} else {
				return wait(time - self.context.currentTime);
			}
		});
	},

	play : function (code) {
		var self = this;
		var ret = new Deferred();
		var position = self.context.currentTime;
		var parts = typeof code == 'string' ? code.split(/\s+/) : code;
		var config = self.config;

		var emptyDuration = self.createToneBuffer(' ', config).duration;

		var playPart = function () {
			var part = parts.shift();
			if (!part) {
				(config.onended || angular.noop)();
				ret.call();
				return;
			}

			(config.onprogress || angular.noop)(part);
			var source = self.context.createBufferSource();
			source.buffer = self.createToneBuffer(part, config);
			source.connect(self.context.destination);
			source.onended = playPart;
			source.start(position);
			position += source.buffer.duration + emptyDuration;
			self.currentSource = source; // retain audio node
		};

		playPart();

		ret.canceller = function () {
			self.currentSource.onended = angular.noop;
			self.currentSource.stop(0);
			delete self.currentSource;
			(config.onended || angular.noop)();
		};

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
						n = 1 * unit;
						length += n;
						sequence.push(-n);
					}
				}
				n = 3 * config.character_spacing * unit;
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
				for (var f = 0, e = self.context.sampleRate * 0.002; f < e; f++) {
					data[x - f] = data[x - f] * (f / e); 
				}
			}
		}

		return buffer;
	}
};

Trainer.Sequence = {};

Trainer.Sequence.Random = function () { this.init.apply(this, arguments) };
Trainer.Sequence.Random.prototype = {
	init : function (chars, opts) {
		this.chars = chars;
		this.opts  = opts || {};

		if (!this.opts.length) this.opts.length = [5, 5];
	},
	
	next : function () {
		var code = '';
		var len = Math.floor((this.opts.length[1] - this.opts.length[0]) * Math.random()) + this.opts.length[0];
		for (var i = 0; i < len; i++) {
			var char = this.chars.charAt(Math.floor(this.chars.length * Math.random()));
			code += char;
		}
		return code;
	}
};

Trainer.Sequence.Words = function () { this.init.apply(this, arguments) };
Trainer.Sequence.Words.prototype = {
	init : function (list) {
		this.list = list;
	},

	next : function () {
		var names = [
			'HIRO',
			'KAZU',
			'YOSHI',
			'TARO'
		];

		var code = this.list[Math.floor(this.list.length * Math.random())];
		code = code.replace(/%callA%/g, String_random(/(J[A-Z][0-9]|7[NM]4|8[NM][0-9])[A-Z]{2,3}/));
		code = code.replace(/%callB%/g, String_random(/(J[A-Z][0-9]|7[NM]4|8[NM][0-9])[A-Z]{2,3}/));
		code = code.replace(/%name%/g, names[Math.floor(names.length * Math.random())]);

		return code;
	}
};

Trainer.TYPES = {
	'random' : new Trainer.Sequence.Random("KMURESNAPTLWI.JZ=FOY,VG5/Q92H38B?47C1D60X"),
	'random-letters' : new Trainer.Sequence.Random("ABCDEFGHIJKLMNOPQRSTUVWXYZ"),
	'random-numbers' : new Trainer.Sequence.Random("0123456789"),
	'random-EISH5' : new Trainer.Sequence.Random("SH5"),

	'words-level1' : new Trainer.Sequence.Words([
		"CQ",
		"DX",
		"PSE",
		"599",
		"73",
		"5NN",
		"SN", // soon
		"TU",  // thank you
		"BK", // break
		"GM", // good morning
		"GA", // good afternoon
		"GE", // good evening
		"GL", // good luck
		"GN", // good night
		"OM",
		"TNK",
		"TNX",
		"TKS",
		"FER",// for
		"CALL",
		"UR", // your
		"SIG",
		"IS",
		"RST", // 
		"RPRT", // report
		"REPRT", // report
		"FB",
		"MI", // my 
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
		"AGN",
		"BTU", // back to you
		"BUG",
		"B4", // before
		"CFM", // confirm
		"CLG", // calling
		"ADR", // address
		"AA", // all after
		"AB", // all before
		"CS", // callsign
		"CTL", // control
		"CUD", // could
		"CUL", // see you later
		"CX", // conditions
		"DSW", // goodbye
		"ENUF", // enough
		"FREQ", // frequency
		"FWD", // forward
		"HEE", // lol
		"HI", // lol
		"HV", // have
		"II", // i say again
		"IMP", // impedance
		"MILS", // milliamperes
		"MNI", // many
		"NIL", // nothing
		"NM", // name
		"NR", // number
		"NX", // noisy
		"PLS", // please
		"PWR", // power
		"PX", // prefix
		"RCVR", // receiver
		"RFI", // RF interference
		"RTTY", // 
		"SAE", // Self-addressed envelope
		"SASE", // Self-addressed, stamped envelope
		"SED", // said
		"SEZ", // says
		"SFR", // so far
		"SKED", // schedule
		"SNR", // signal noise ratio
		"SRI", // sorry
		"SSB",
		"STN", // station
		"TMW", // tomorrow
		"TT", // that
		"TXT",
		"URS",
		"VX", // voice, phone
		"VY", // very
		"WA", // word after
		"WB", // word before
		"WID", // with
		"WKD", // worked
		"WKG", // working
		"WUD", // would
		"WTC", // what the craic?
		"XCVR", // transceiver
		"XMTR", // transmitter
		"XYL", // wife
		"YL", 
		"SOON",
		"CL", // close
		"BECUZ", // because
		"CUZ", // because
		"LTR", // letter
		"HR", // here
		"I AM",
		"OF THE",
		"TEST",
		"GOING",

		"GO",
		"AM",
		"ME",
		"ON",
		"BY",
		"TO",
		"UP",
		"SO",
		"IT",
		"NO",
		"OF",
		"AS",
		"HE",
		"IF",
		"AN",
		"US",
		"OR",
		"IN",
		"IS",
		"AT",
		"VAR",
		"WE",
		"DO",
		"BE",
		"AND",
		"MAN",
		"HIM",
		"OUT",
		"NOT",
		"BUT",
		"CAN",
		"WHO",
		"HAS",
		"MAY",
		"WAS",
		"ONE",
		"SHE",
		"ALL",
		"YOU",
		"HOW",
		"ANY",
		"ITS",
		"SAY",
		"ARE",
		"NOW",
		"TWO",
		"FOR",
		"MEN",
		"HER",
		"HAD",
		"THE",
		"OUR",
		"HIS",
		"BEEN",
		"SOME",
		"THEN",
		"LIKE",
		"WELL",
		"MADE",
		"WHEN",
		"HAVE",
		"ONLY",
		"YOUR",
		"WORK",
		"OVER",
		"SUCH",
		"TIME",
		"WERE",
		"WITH",
		"INTO",
		"VERY",
		"WHAT",
		"THEN",
		"MORE",
		"WILL",
		"THEY",
		"COME",
		"THAT",
		"FROM",
		"MUST",
		"SAID",
		"THEM",
		"THIS",
		"UPON",
		"GREAT",
		"ABOUT",
		"OTHER",
		"SHALL",
		"EVERY",
		"THESE",
		"FIRST",
		"THEIR",
		"COULD",
		"WHICH",
		"WOULD",
		"THERE",
		"BEFORE",
		"SHOULD",
		"LITTLE",
		"PEOPLE",
		"DE %callA%",
		"DE %callA%",
		"QTH", // 常置場所
		"QRS",
		"QSO",
		"QSL",
		"QRM",
		"QSB",
		"QSY",
		"QRP",
		"QRL",  // 使用中です
		"QRL?", // 使用中ですか?
		"QRZ?", // 誰か呼びましたか？
		"QRA?", // 貴局名はなんですか？
		"QRH?", // こちらの周波数は変化しますか？
		"QRI?", // こちらの音調はどうですか？
		"QRK?", // こちらの明瞭度はどうですか？
		"QRM?", // 混信をうけていますか？
		"QRN?", // 空電の影響をうけていますか？
		"QRO?", // 電力を増やしますか？
		"QRP?", // 電力を減らしますか？
		"QRQ?", // もっと早くしますか？
		"QRS?", // もっと遅くしますか？
		"QRU?", // こちらに伝送するものがありますか？
		"QSB?", // フェージングがありますか？
		"QSD?", // こちらの信号はきれますか？
		"QSM?", // そちらが送信した電報を反復しますか？
		"QTH?", // 位置はなんですか？
		"QSW?", // そちらは，この周波数(又は……kHz(若しくはMHz))で(種別……の発射で)送信してくれませんか。
		"QSX?", // そちらは，……(名称又は呼出符号)を……kHz(又はMHz)で又は……の周波数帯若しくは……の通信路で聴取してくれませんか。
		"QSU?", // こちらは，この周波数(又は……kHz(若しくはMHz))で(種別……の発射で)送信又は応答しましようか。

		"JH1UMV"
	]),

	'words-level2' : new Trainer.Sequence.Words([
		"BUSINESS",
		"COMPANY",
		"OFFICE",
		"WANT",
		"STORE",
		"WAY",
		"ORDER",
		"CALL",
		"SERVICE",
		"BASE",
		"PAY",
		"PRODUCT",
		"REPORT",
		"PROBLEM",
		"JOB",
		"MARKET",
		"PRICE",
		"RATE",
		"CHANGE",
		"CHECK",
		"PART",
		"PLAN",
		"SALE",
		"ROOM",
		"AREA",
		"FREE",
		"SURE",
		"INCREASE",
		"TAX",
		"RECEIVE",
		"INCLUDE",
		"PROGRAM",
		"COST",
		"GOVERNMENT",
		"OFFER",
		"CHARGE",
		"EXPERIENCE",
		"STATE",
		"INFORMATION",
		"ACCOUNT",
		"TURN",
		"FORM",
		"DECIDE",
		"CUSTOMER",
		"LINE",
		"SCHEDULE",
		"SIGN",
		"SHOW",
		"DRIVE",
		"RETURN",
		"DEPARTMENT",
		"RUN",
		"CLOSE",
		"SERVE",
		"CAUSE",
		"ARRIVE",
		"BOARD",
		"EXPECT",
		"AIR",
		"SYSTEM",
		"COURSE",
		"OWN",
		"BILL",
		"ENJOY",
		"PUBLIC",
		"MANAGER",
		"SEAT",
		"WEATHER",
		"STAND",
		"NOTICE",
		"TRIP",
		"HAPPEN",
		"BREAK",
		"COMPLETE",
		"FILL",
		"FLOOR",
		"AGE",
		"TYPE",
		"POINT",
		"PASSENGER",
		"MAIN",
		"CARE",
		"SAVE",
		"DEVELOP",
		"PROVIDE",
		"ALLOW",
		"SPEND",
		"DROP",
		"HOLD",
		"MAIL",
		"COPY",
		"INTERNATIONAL",
		"PASS",
		"MESSAGE",
		"FRONT",
		"CONDITION",
		"FIRE",
		"PROBABLY",
		"TERM",
		"INTEREST",
		"REQUEST",
		"FOREIGN",
		"MEAL",
		"CONTROL",
		"DISCOUNT",
		"REGULAR",
		"WEAR",
		"TROUBLE",
		"EXPENSIVE",
		"INDUSTRY",
		"LOCAL",
		"POSITION",
		"BUSY",
		"REACH",
		"TRAFFIC",
		"VALUE",
		"POSSIBLE",
		"COVER",
		"MIND",
		"ENERGY",
		"RESULT",
		"MATTER",
		"POST",
		"ACCIDENT",
		"AMOUNT",
		"ATTEND",
		"CONTINUE",
		"DEGREE",
		"HEART",
		"PREFER",
		"PLANT",
		"DISCUSS",
		"CASH",
		"CONVERSATION",
		"RECORD",
		"DIRECT",
		"HEAD",
		"DIRECTLY",
		"PARTY",
		"BOSS",
		"POLICY",
		"FALL",
		"PICK",
		"CASE",
		"AIRLINE",
		"NECESSARY",
		"SURPRISE",
		"POPULAR",
		"STUDY",
		"DESIGN",
		"MEDICINE",
		"LAW",
		"LEAD",
		"LIST",
		"PERIOD",
		"SAFE",
		"STEP",
		"SHORT",
		"APPLY",
		"PRODUCE",
		"COUPLE",
		"CHANCE",
		"PRESENT",
		"FINE",
		"FORCE",
		"LIKELY",
		"PREPARE",
		"DECISION",
		"TOTAL",
		"LIMIT",
		"TRAINING",
		"CORNER",
		"REASON",
		"LIMITATION",
		"ADD",
		"NATIONAL",
		"FACE",
		"EXPRESS",
		"DEMAND",
		"DEPEND",
		"REPAIR",
		"GAS",
		"SHIP",
		"CROWDED",
		"LOSE",
		"CLEAR",
		"SOUND",
		"ACTIVITY",
		"CROWD",
		"DAILY",
		"RAISE",
		"CATCH",
		"EXERCISE",
		"SKIN",
		"GROUND",
		"AGREE",
		"READY",
		"PRESS",
		"TOUR",
		"DATE",
		"DEAL",
		"ENTER",
		"LEVEL",
		"ACCEPT",
		"DAMAGE",
		"EXCELLENT",
		"PATIENT",
		"PROCESS",
		"BLOCK",
		"JOIN",
		"REMEMBER",
		"IMMEDIATELY",
		"TASTE",
		"DOWNTOWN",
		"FOLLOW",
		"RISE",
		"HANDLE",
		"TRADE",
		"REST",
		"CHEAP",
		"EXCEPT",
		"FUTURE",
		"LAND",
		"SUIT",
		"FAIL",
		"FURNITURE",
		"SAFETY",
		"LANGUAGE",
		"QUARTER",
		"ADVISE",
		"AHEAD",
		"SINGLE",
		"CROSS",
		"DISEASE",
		"EARN",
		"IMPROVE",
		"FAVORITE",
		"INFORM",
		"PURPOSE",
		"SUGGEST",
		"CHOOSE",
		"DISTANCE",
		"TIRED",
		"ATTENTION",
		"BALANCE",
		"BALANCED",
		"FIGURE",
		"SUPPORT",
		"CLOTHES",
		"DRESS",
		"WAR",
		"APPEAR",
		"ADDRESS",
		"CAREFUL",
		"BRANCH",
		"DIAL",
		"FIX",
		"PROMISE",
		"MEDIA",
		"WONDER",
		"RACE",
		"ACTUALLY",
		"ADULT",
		"ADVICE",
		"APPEARANCE",
		"WARN",
		"ANGRY",
		"ANNOUNCE",
		"ANNOUNCEMENT",
		"CLAIM",
		"GENERAL",
		"CREATE",
		"DELIVER",
		"DRUG",
		"SALARY",
		"EFFORT",
		"PERSONAL",
		"PRIVATE",
		"RECENTLY",
		"PRACTICE",
		"STANDARD",
		"EDUCATION",
		"VIEW",
		"FILM",
		"HANG",
		"AGENCY",
		"ENTRANCE",
		"GUESS",
		"MONTHLY",
		"HEAT",
		"SHARE",
		"MATERIAL",
		"PRINT",
		"EXCUSE",
		"DOUBLE",
		"INVITE",
		"INVITATION",
		"BORROW",
		"EFFECT",
		"FORWARD"
	])
};

(function () {
	var koch = "KMURESNAPTLWI.JZ=FOY,VG5/Q92H38B?47C1D60X";
	for (var i = 1; i <= 40; i++) {
		Trainer.TYPES["koch-" + i] = new Trainer.Sequence.Random(koch.substr(0, i + 1));
	}
})();

$(function () {

	var $start          = $('#start').focus();
	var $answer         = $('#answer');
	var $answerInput    = $('#answer-input');
	var $answerAnswer   = $('#answer-answer');
	var $answerAccuracy = $('#answer-accuracy');
	var $elapsed        = $('#elapsed');
	var $input          = $('#input');
	var $config         = $('.config');

	var config = {
		time: 10
	};

	var trainer = new Trainer(config);

	if (!localStorage.history) localStorage.history = JSON.stringify([]);

	$start.click(function () {
		$answer.hide();
		$config.hide();

		$answerInput.empty();
		$answerAnswer.empty();
		$input.val('').show().focus();
		$start.attr('disabled', 'disabled');

		var start = new Date();
		var timer = setInterval(function () {
			$elapsed.text( Math.floor((new Date() - start) / 1000) );
		}, 1000);

		var answers = [];

		trainer.start(function (answer) {
			console.log(answer);
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
					var m = it[1].match(/(\n)/g);
					if (m) {
						$('<span/>').text(new Array(m.length + 1).join("\n")).appendTo($a);
					}
					$('<span class="insert"/>').text(it[1]).appendTo($i);
				}
			}

			$answerInput.append($i);
			$answerAnswer.append($a);

			var distanse  = dmp.diff_levenshtein(dmp.diff_main(inputsJoined.replace(/\s/g, ''), answersJoined.replace(/\s/g, '')));
			var wrongRate = distanse / answersJoined.replace(/\s+/g, '').length;
			var accuracy  = (1 - wrongRate) * 100;

			var history = [];
			try {
				history = JSON.parse(localStorage.history);
			} catch (e) { alert(e) }

			history.push({
				type : trainer.config.type,
				accuracy : accuracy,
				wpm : trainer.config.wpm,
				time : new Date().getTime()
			});

			while (history.length > 1000) history.shift();

			localStorage.history = JSON.stringify(history);

			$answerAccuracy.text(accuracy.toFixed(1) + '%');
			if (accuracy >= 90) {
				$answerAccuracy.addClass('success');
			} else {
				$answerAccuracy.removeClass('success');
			}

			$answer.show();
			$config.show();
			$start.removeAttr('disabled');
			$start.focus();
		}).
		error(function (e) {
			alert(e);
		});
	});

	$('#type').change(function () {
		trainer.config.type = $(this).val();
		localStorage.type = $(this).val();
	}).val(localStorage.type || 'koch-1').change();

	$('#speed').change(function () {
		var wpm = +$(this).val();
		var cpm = wpm * 5;

		trainer.config.wpm = wpm;

		localStorage.wpm = wpm;

		$('#speed-label').text(
			wpm + 'wpm ' + 
			cpm + 'cpm'
		);
	}).val(localStorage.wpm || 15).change();

	$('#character-spacing').change(function () {
		var val = +$(this).val();

		trainer.config.character_spacing = val;
		localStorage.character_spacing = val;
	}).val(localStorage.character_spacing || 2.0).change();

	$('#word-spacing').change(function () {
		var val = +$(this).val();

		trainer.config.word_spacing = val;
		localStorage.word_spacing = val;
	}).val(localStorage.word_spacing || 2.0).change();

	$('#tone').change(function () {
		var val = +$(this).val();

		trainer.config.tone = val;
		localStorage.tone = val;
	}).val(localStorage.tone || 600).change();

	$('#length').change(function () {
		var val = +$(this).val();

		trainer.config.time = val * 60;
		localStorage.time = val;
	}).val(localStorage.time || 1).change();

	window.play = function (chars) {
		trainer.play(chars);
	};
	// play(Array(100).join('.').replace(/./g, function () { return Math.random() > 0.5 ? 'K' : 'R' }).split(/(.....)/).join(' '));
});
