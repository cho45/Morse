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

MorsePlayer = function () { this.init.apply(this, arguments) };
MorsePlayer.prototype = {
	init : function () {
		var self = this;
		self.context = new AudioContext();
	},

	play : function (code, config) {
		var self = this;
		var position = self.context.currentTime;
		var parts = typeof code == 'string' ? code.split(/\s+/) : code;

		var emptyDuration = self.createToneBuffer(' ', config).duration;

		var playPart = function () {
			var part = parts.shift();
			if (!part) {
				(config.onended || angular.noop)();
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

		var cancel = function () {
			self.currentSource.onended = angular.noop;
			self.currentSource.stop(0);
			delete self.currentSource;
			(config.onended || angular.noop)();
		};

		return cancel;
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
			var m = Morse.codes[c];
			if (!m || c == ' ') {
				n = 7 * config.word_spacing * unit;
				length += n;
				sequence.push(-n);
			} else {
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


var App = angular.module('App', []);

App.factory('location', function () {
	return Location.parse(location.href);
});

App.filter("decodeURIComponent", function () {
	return decodeURIComponent;
});

App.filter("encodeURIComponent", function () {
	return encodeURIComponent;
});

App.directive('persistent', function ($parse) {
	return {
		require: 'ngModel',
		link:  function (scope, elem, attrs, ngModel) {
			var name = attrs.persistent;
			var value = localStorage[name];

			if (typeof(value) === 'undefined') {
				$parse(attrs.ngModel).assign(scope, +attrs.value);
			} else {
				$parse(attrs.ngModel).assign(scope, +value);
			}

			scope.$watch(attrs.ngModel, function (newValue, oldValue) {
				localStorage[name] = newValue;
			});
		}
	};
});

App.directive('newsProgress', function () {
	return {
		restrict: 'E',
		scope: false,
		link : function (scope, elem, attrs, ctrl) {
			scope.Progress = {
				init : function (parts) {
					elem.empty();
					var pre = $('<pre/>').appendTo(elem);

					this.parts = [];
					for (var i = 0, len = parts.length; i < len; i++) {
						var span = $('<span/>').text(parts[i]).appendTo(pre);
						this.parts.push(span);
					}

					this.n = 0;
				},

				progress : function (n) {
					this.n += n;
					if (this.current) {
						this.current.removeClass('current');
					}
					this.current = this.parts[this.n];
					if (this.current) {
						this.current.addClass('current');
					}
				}
			};
		}
	};
});

App.value('config', {
	feeds : [
		{
			name:"Engadget",
			url: "http://www.engadget.com/rss.xml"
		},
		{
			name:"Google News (Top)",
			url: "http://news.google.com/news?output=atom"
		},
		{
			name:"Google News (World)",
			url: "http://news.google.com/news?output=atom&topic=w"
		},
		{
			name:"Google News (Business)",
			url: "http://news.google.com/news?output=atom&topic=w"
		},
		{
			name:"Google News (Politics)",
			url: "http://news.google.com/news?output=atom&topic=p"
		},
		{
			name:"Google News (Entertainment)",
			url: "http://news.google.com/news?output=atom&topic=e"
		},
		{
			name:"Google News (Sports)",
			url: "http://news.google.com/news?output=atom&topic=s"
		},
		{
			name:"Google News (Technology)",
			url: "http://news.google.com/news?output=atom&topic=t"
		},
		{
			name:"Google News (Most Popular)",
			url: "http://news.google.com/news?output=atom&topic=po"
		}
	]
});

App.controller('MainCtrl', function ($scope, $sce, $document, $timeout, $http, location, config) {
	var player = new MorsePlayer();
	
	$scope.feeds = config.feeds;
	$scope.loadingProgress = 0;
	$scope.input = '';
	$scope.config = {
		wpm : 20,
		tone : 600,
		character_spacing: 1,
		word_spacing: 1
	};

	$scope.setSource = function (feed) {
		$scope.loadingProgress = 10;
		$scope.source = feed;

		var timer = $timeout(function () {
			$scope.loadingProgress = 50;
		}, 250);

		var pipe = 'http://pipes.yahoo.com/pipes/pipe.run?URL=' + encodeURIComponent(feed.url) + '&_id=9fd3944af37e930352af04bf5ca7bfb4&_render=json&_callback=JSON_CALLBACK';
		$http.jsonp(pipe).then(function (data) {
			if (data.status !== 200) {
				throw "Failed to load from pipes";
			}

			var CT = "\x01\n", BT = "=\n\n", AR = "+\n\n\n", VA = "\x04";
			var value = CT;
			for (var i = 0, it; (it = data.data.value.items[i]); i++) {
				value += it.title + BT;
				var html = it.content ? it.content.content : it.description;
				var div  = $('<div/>').html(html.replace(/<[^ ]+[^>]*>/g, function (_) { return _ }));
				value += div.text() + AR;
			}

			$scope.input = value + VA;

			$timeout.cancel(timer);
			$scope.loadingProgress = 100;

			$timeout(function () {
				if ($scope.loadingProgress == 100) $scope.loadingProgress = -1;
			}, 1000);
		});
	};

	$scope.$watch('input', function (newValue, oldValue) {
		var input = $scope.input;
		var parts = input.split(/(\s+)/);

		$scope.Progress.init(parts);
	});

	$scope.play = function () {
		var input = $scope.input;

		$scope.playing = true;

		$scope.Progress.progress(-2);
		$scope.config.onprogress = function () {
			console.log('progress');
			$scope.Progress.progress(2);
		};

		$scope.config.onended = function () {
			$scope.playing = false;
			$scope.Progress.n = -1;
			$scope.Progress.progress(0);
			$scope.$apply();
		};
		var cancel = player.play(input, $scope.config);
		$scope.stop = function () {
			cancel();
		};
	};

	$scope.setSource(config.feeds[0]);
});
