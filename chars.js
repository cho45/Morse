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


Play = function () { this.init.apply(this, arguments) };
Play.prototype = {
	init : function () {
		var self = this;
		self.context = new AudioContext();
	},

	play : function (code, config) {
		var self = this;
		var source = self.context.createBufferSource();
		source.buffer = self.createToneBuffer(code, config);
		source.connect(self.context.destination);
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
				for (var f = 0, e = self.context.sampleRate * 0.004; f < e; f++) {
					data[x - f] = data[x - f] * (f / e); 
				}
			}
		}

		return buffer;
	}
};

$(function () {
	if (typeof AudioContext === 'undefined') {
		$($('noscript').text()).replaceAll('noscript');
		return;
	}

	$(extended('main', {})).replaceAll('#main');

	var opts = {
		wpm : +localStorage['chars-wpm']   || 20,
		tone : +localStorage['chars-tone'] || 600, 
		word_spacing : 1,
		character_spacing: 1
	};

	$('#options form').submit(function () {
		return false;
	});

	$('#options input').on('keyup change', function () {
		var $this = $(this);
		var name = $this.attr('name');
		opts[name] = +$this.val();
		localStorage['chars-' + name] = $this.val();
	}).each(function () {
		this.value = opts[this.name];
	});

	var play = new Play();

	$('button[data-char]').click(function () {
		play.play($(this).attr('data-char'), opts);
	});

	$('#play-text').submit(function () {
		try {
			var text = $(this).find('textarea').val().replace(/\s+/g, ' ');
			if (text) {
				play.play(text, opts);
			}
		} catch (e) { alert(e) }
		return false;
	});

});
