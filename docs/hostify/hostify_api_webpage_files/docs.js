function navHide() {
	$('.nav').removeClass('nav-collapsed');
	$('.collapse').removeClass('nav-collapsed');
}

function navShow() {
	$('.nav').addClass('nav-collapsed');
	$('.collapse').addClass('nav-collapsed');
}

function goto(id) {
	if (active == id) {
		return;
	}
	let a = $(`.menu a[data-href=${id}]`);
	if (!a.length) return;
	let p = a.parent().parent().prev();
	if (p.is('a')) {
		$(p).trigger('click');
	}
	$(a).trigger('click');

	window.location.hash = id;

	active = id;
}

var active;
var sec = [];

$(function() {
	$('.nav a[href^="#"]').on('click', function(e) {
		navHide();
		$('.menu a').removeClass('active');
		$(e.currentTarget).addClass('active');
	});

	$('.category>a').on('click', function(e) {
		var id = $(e.currentTarget).attr('data-href');
		$('.category').find(`.sub:not(.${id})`).hide();
		$('.category').find(`.sub.${id}`).show(200);
	});

	$('.collapse').on('click', function(e) {
		return $('.nav').hasClass('nav-collapsed') ? navHide() : navShow();
	});

	var jsons = [];

	$.each($('[data-json]'), function(k, v) {
		var json = $(v).attr('data-json');
		jsons.push(json);
	});

	$.post(`/docs/getResponses/`, {keys:jsons}, function(result) {
		$.each($('[data-json]'), function(k, v) {
			var key = $(v).attr('data-json');

			if (result[key]) {
				var json = (result[key].trim());
				if (json && json.length) {
					var f = formatter.formatJson(json);
					$(v).html(f);
				} else {
					$(v).addClass('response-empty');
				}

			}
		});

	});

	$.each($('.is-json'), function(k, v) {
		var json = $(v)[0].innerText.trim();
		if (!json || !json.length) return;
		var f = formatter.formatJson(json);
		$(v).html(f);
	});

	if(window.location.hash) {
		goto(window.location.hash.slice(1));
	}
});

$(document).ajaxComplete(function() {
	$('body').removeClass('not-ready');
});