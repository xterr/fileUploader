;(function($, undefined) {

var fh = fh || {};

fh.AbstractHandler = function(options) {
	var defaults = {
		inputName        : 'file',
		params           : {},
		successStatus    : null,
		action           : null,
		element          : null,
		allowedExtensions: [],
		onInit           : null,
		onBeforeSubmit   : null,
		onSuccess        : null,
		onComplete       : null,
		onError          : null,
		onProgress       : null
	};

	this.options = $.extend({}, defaults, options);
};

fh.AbstractHandler.prototype = {
	_xhrs             : [],
	_errors           : [],
	_completedRequests: [],
	_button           : null,
	_input            : null,

	init: function() {
		this._trigger('onInit');
	},

	_trigger: function(name) {
		var options = this.options;

		if (!$.isFunction(options[name]))
		{
			return true;
		}

		return options[name].apply(this, Array.prototype.slice.call(arguments, 1));
	},

	_getUniqueId: function() {
		if (this._currentUniqueId == undefined)
		{
			this._currentUniqueId = 0;
		}

		return ++this._currentUniqueId;
	},

	_getFileName: function(name) {
		return name.replace(/.*(\/|\\)/, "");
	},

	_isExtensionAllowed: function(fileName) {
		var self    = this;
		var ext     = (-1 !== fileName.indexOf('.')) ? fileName.replace(/.*[.]/, '').toLowerCase() : '';
		var allowed = self.options.allowedExtensions;

		if (allowed.length == 0)
		{
			return true;
		}

		for (var i=0; i<allowed.length; i++)
		{
			if (allowed[i].toLowerCase() == ext)
			{
				return true;
			}
		}

		return false;
	},

	_calculateMaxFiles: function(nFiles) {
		var self       = this;
		var maxDropped = self.options.maxFilesDropped;
		var max        = $.isFunction(maxDropped) ? maxDropped(nFiles) : maxDropped;

		if (max < nFiles)
		{
			self._onError(null, null, null, 'maxFilesDropped');
			self._trigger('onError', self._errors);
			self._errors = [];
			return false;
		}

		return true;
	},

	_upload: function() {},

	_onBeforeSubmit: function(id, fileName) {
		var self = this;
		var bOk  = true;

		if (fileName != '' && !self._isExtensionAllowed(fileName))
		{
			self._onError(id, fileName, null, 'extensionError');
			bOk = false;
		}

		if (fileName == '')
		{
			self._onError(id, fileName, null, 'noFile');
			bOk = false;
		}

		if (!self._trigger('onBeforeSubmit', id, fileName))
		{
			bOk = false;
		}

		return bOk;
	},

	_onProgress: function(id, fileName, extraData) {
		this._trigger('onProgress', id, fileName, extraData);
	},

	_onSuccess: function(id, fileName, result) {
		if (result !== undefined && result.status == this.options.successStatus)
		{
			this._trigger('onSuccess', id, fileName, result);
		}
		else
		{
			this._onError(id, fileName, result, 'failure');
		}
	},

	_onComplete: function(id, fileName, result) {
		var self = this;

		self._completedRequests.push({
			id      : id,
			fileName: fileName,
			result  : result
		});

		var remainingXhrs = 0;

		$.each(self._xhrs, function(index, value) {
			if (value !== undefined && value !== null)
			{
				remainingXhrs++;
			}
		});

		if (remainingXhrs == 0)
		{
			self._trigger('onComplete', self._completedRequests);
			self._trigger('onError', self._errors);
			self._completedRequests = [];
			self._errors            = [];
		}
	},

	_onError: function(id, fileName, result, errorType) {
		this._errors.push({
			id       : id,
			fileName : fileName,
			result   : result,
			errorType: errorType
		});
	}
};

fh.LegacyUploadHandler = function(options) {
	fh.AbstractHandler.apply(this, arguments);
};

$.extend(fh.LegacyUploadHandler.prototype, fh.AbstractHandler.prototype);
$.extend(fh.LegacyUploadHandler.prototype, {
	_form : null,

	init: function() {
		fh.AbstractHandler.prototype.init.apply(this, arguments);
		var self    = this;
		var options = self.options;

		self._form   = options.element.find('form.ui-fileUpload-form');
		self._input  = self._form.find('input[type=file]');
		self._button = self._form.find(':submit');

		if (self._form.length == 0 || self._input.length == 0 || self._button.length == 0)
		{
			return false;
		}

		self._upload();
	},

	_upload: function() {
		var self     = this;
		var id       = null;
		var fileName = null;

		self._form.ajaxForm({
			data: self.options.params,
			beforeSubmit: function(formData, $form, options) {
				if (!self._calculateMaxFiles(1))
				{
					return false;
				}

				id             = self._getUniqueId();
				fileName       = self._getFileName(self._input.val());
				self._xhrs[id] = 1;

				if (!self._onBeforeSubmit(id, fileName))
				{
					self._xhrs[id] = null;
					self._onComplete(id, fileName, {});
					return false;
				}

				self._button.attr('disabled', true);
				self._onProgress(id, fileName);

				return true;
			},
			success: function(data, status, xhr, $form) {
				self._button.attr('disabled', false);
				self._xhrs[id] = null;

				self._onSuccess(id, fileName, data);
				self._onComplete(id, fileName, data);
			},
			error: function(xhr, error, thrownError) {
				self._button.attr('disabled', false);
				self._xhrs[id] = null;

				var result = {};

				try
				{
					result = $.parseJSON(xhr.responseText);
				}
				catch (e)
				{}

				self._onError(id, fileName, result, 'exception');
				self._onComplete(id, fileName, result);
			},
			dataType: 'json'
		});
	}
});

fh.XHRUploadHandler = function(options) {
	fh.AbstractHandler.apply(this, arguments);
};

$.extend(fh.XHRUploadHandler.prototype, fh.AbstractHandler.prototype);
$.extend(fh.XHRUploadHandler.prototype, {
	_dropArea           : null,
	_filesDropped       : 0,
	_loaded             : [],
	_completedRequests  : [],

	init: function() {
		fh.AbstractHandler.prototype.init.apply(this, arguments);

		this._createButton();
		this._createDragArea();
	},

	_createButton: function() {
		var self     = this;
		self._button = self.options.element.find('.ui-fileUpload-button');

		self._button.css({
			position : 'relative',
			overflow : 'hidden',
			direction: 'ltr'
		});

		self._button.append(self._createInput());
	},

	_createInput: function() {
		var self = this;

		self._input = $('<input />').attr({
			type    : 'file',
			name    : self.options.inputName,
			id      : 'uploadInput',
			multiple: 'multiple'
		}).css({
			position: 'absolute',
			right   : 0,
			top     : 0,
			fontSize: '118px',
			margin  : 0,
			padding : 0,
			cursor  : 'pointer',
			opacity : 0
		}).on('change', function(event){
			self._onDrop(this.files);
		});

		if (window.attachEvent)
		{
			self._input.attr('tabIndex', -1);
		}

		return self._input;
	},

	_createDragArea: function() {
		var self = this;
		jQuery.event.props.push("dataTransfer");

		self._dropArea = self.options.element.find('.ui-fileUpload-dropArea')
			.bind('dragenter', function(event) {
				if (!self._isValidFileDrag(event))
				{
					return;
				}

				$(this).addClass('ui-fileUpload-dropArea-hover');
			})
			.bind('dragleave', function(event) {
				$(this).removeClass('ui-fileUpload-dropArea-hover');

				if (!self._isValidFileDrag(event) || $(this)[0] == event.target || $(this).find($(event.relatedTarget)).length != 0)
				{
					return false;
				}
			})
			.bind('dragover', function(event){
				if (!self._isValidFileDrag(event))
				{
					return false;
				}

				var effect = event.dataTransfer.effectAllowed;

				if (effect == 'move' || effect == 'linkMove')
				{
					event.dataTransfer.dropEffect = 'move'; // for FF (only move allowed)
				}
				else
				{
					event.dataTransfer.dropEffect = 'copy'; // for Chrome
				}

				event.stopPropagation();
				event.preventDefault();
			})
			.bind('drop', function(event){
				if (!self._isValidFileDrag(event))
				{
					return;
				}

				event.preventDefault();

				$(this).removeClass('ui-fileUpload-dropArea-hover');
				self._onDrop(event.dataTransfer.files);
			});
	},

	_onDrop: function(files) {
		var self           = this;
		self._filesDropped = files.length;

		if (!self._calculateMaxFiles(self._filesDropped))
		{
			return false;
		}

		if (!self._trigger('onDrop', files))
		{
			return false;
		}

		$.each(files, function(index, file) {
			var id       = self._getUniqueId();
			self._upload(id, file);
		});
	},

	_upload: function(id, file) {
		var self     = this;
		var fileName = file.name !== null ? file.name : file.fileName;
		var fileSize = file.size !== null ? file.size : file.fileSize;

		var xhr = self._xhrs[id] = new XMLHttpRequest();

		if (!self._onBeforeSubmit(id, fileName))
		{
			self._xhrs[id] = null;
			self._onComplete(id, fileName, {});
			return false;
		}

		self._loaded[id] = 0;

		xhr.upload.onprogress = function(event) {
			if (event.lengthComputable)
			{
				self._loaded[id] = event.loaded;
				self._onProgress(id, fileName, {loaded: event.loaded, total: event.total});
			}
		};

		xhr.onreadystatechange = function() {
			var result = {};

			if (xhr.readyState == 4)
			{
				try
				{
					result = $.parseJSON(xhr.responseText);
				}
				catch(e) {}

				self._loaded[id] = null;
				self._xhrs[id]   = null;

				self._onSuccess(id, fileName, result);
				self._onComplete(id, fileName, result);
			}
		};

		var url    = null;
		var params = self.options.params;
		var action = self.options.action;
		var temp   = (/\?/.test(action)) ? (/\?$/.test(action)) ? '' : '&' : '?';

		params[self.options.inputName] = fileName;
		url = action + temp + $.param(params);

		xhr.open("POST", url, true);
		xhr.setRequestHeader("Cache-Control", "no-cache");
		xhr.setRequestHeader("X-Requested-With", "XMLHttpRequest");
		xhr.setRequestHeader("X-File-Name", encodeURIComponent(name));
		xhr.setRequestHeader("X-File-Size", fileSize);
		xhr.setRequestHeader("Content-Type", "application/octet-stream");
		xhr.send(file);
	},

	_isValidFileDrag: function(event) {
		var dt = event.dataTransfer,
		isWebkit = navigator.userAgent.indexOf("AppleWebKit") > -1;
		return dt && dt.effectAllowed != 'none' && (dt.files || (!isWebkit && dt.types.contains && dt.types.contains('Files')));

	}
});

$.widget("ui.fileUploader", {
	name      : "fileUploader",
	version   : '1.0.1',
	author    : ['Ceana Razvan'],
	copyright : '2011 DG International',
	package   : 'XDating',
	dependencies : {
		jQuery   : '1.7.0',
		jQueryUI : '1.8.16',
		ajaxForm : '2.82'
	},
	options: {
		debug            : true,
		action           : null,
		listElement      : '.ui-fileUpload-list',
		params           : {},
		maxFilesDropped  : 3,
		successStatus    : 'ok',
		allowedExtensions: [],
		inputName        : 'file',
		sizeLimit        : 0,
		minSizeLimit     : 0,
		legacyEnabled    : true,
		useOnlyLegacy    : false,
		onBeforeSubmit   : null,
		onError          : null,
		onProgress       : null,
		onSuccess        : null,
		onDrop           : null,
		onCancel         : null,
		onLeave          : function() {},
		messages : {
			extensionError : "<b>{file}</b> has invalid extension. Only {extensions} are allowed.",
			exception      : "<b>{file}</b> could not be uploaded",
			failure        : "<b>{file}</b> could not be uploaded",
			noFile         : "No file selected",
			maxFilesDropped: "You can upload maximum <b>{maxFilesDropped}</b> files"
		}
	},

	_uploadHandler  : null,
	_filesInProgress: 0,
	_filesDropped   : 0,
	_fileList       : null,
	_useFileList    : false,
	_errors         : [],

	_init: function() {
		var self     = this;
		var listElem = self.options.listElement;

		if (listElem !== null)
		{
			listElem          = $(listElem);
			self._useFileList = listElem.length != 0 ? true : false;
		}
	},

	_create: function() {
		var self = this;
		self._log('Starting plugin');

		self._createUploadHandler();
		self._preventLeaveInProgress();
	},

	_createUploadHandler : function() {
		var self         = this;
		var handlerClass = null;

		if (self._isXHRUploadSupported() && !self.options.useOnlyLegacy)
		{
			self.element.find('.ui-fileUpload-legacy').hide();
			self.element.find('.ui-fileUpload-new').show();
			handlerClass = 'XHRUploadHandler';
		}
		else if (self.options.legacyEnabled)
		{
			self.element.find('.ui-fileUpload-legacy').show();
			self.element.find('.ui-fileUpload-new').hide();
			handlerClass = 'LegacyUploadHandler';
		}
		else
		{
			self._log('Plugin cannot start');
			return;
		}

		self._uploadHandler = new fh[handlerClass]({
			maxFilesDropped  : self.options.maxFilesDropped,
			inputName        : self.options.inputName,
			action           : self.options.action,
			params           : self.options.params,
			element          : self.element,
			allowedExtensions: self.options.allowedExtensions,
			successStatus    : self.options.successStatus,

			onBeforeSubmit: function(id, fileName) {
				return self._onBeforeSubmit(id, fileName);
			},
			onProgress: function(id, fileName, extraData) {
				self._onProgress(id, fileName, extraData);
			},
			onDrop: function(filesDropped) {
				return self._onDrop(filesDropped);
			},
			onSuccess: function(id, fileName, result) {
				self._onSuccess(id, fileName, result);
			},
			onComplete: function(request) {
				self._onComplete(request);
			},
			onError: function(errors) {
				self._errors = errors;
				self._onError();
			}
		});

		self._uploadHandler.init();
	},

	_onBeforeSubmit : function(id, fileName) {
		var self = this;

		self._filesInProgress++;
		self._addToList(id, fileName);

		return self._trigger('onBeforeSubmit', null, {fileName: fileName});
	},

	_onProgress: function(id, fileName, extraData) {
		this._trigger('onProgress', null, {fileName: fileName, extraData: extraData});
	},

	_onDrop: function(files) {
		return this._trigger('onDrop', null, {files: files});
	},

	_onSuccess : function(id, fileName, result) {
		var self = this;
		var file = self._getFileById(id);

		self._filesInProgress--;

		if (self._filesInProgress < 0)
		{
			self._filesInProgress = 0;
		}

		self._setFileStatus(id, 'success');
		self._trigger('onSuccess', null, {fileName: fileName, result: result});
	},

	_onComplete : function(request) {
		this._trigger('onComplete', null, request);
	},

	_onError : function() {
		var self   = this;
		var errors = self._errors;

		if (errors.length == 0)
		{
			return;
		}

		$.each(errors, function(index, error){
			var file = self._getFileById(error.id);
			self._filesInProgress--;

			if (self._filesInProgress < 0)
			{
				self._filesInProgress = 0;
			}

			if (file != undefined)
			{
				self._setFileStatus(error.id, 'error');
			}

			errors[index].message = self._getErrorMessage(error.errorType, error.fileName);
		});

		self._trigger('onError', null, errors);
		self._errors = [];
	},

	_getFileById: function(id) {
		var self  = this;
		var files = self._fileList;

		if (files == undefined || files[id] == undefined)
		{
			return null;
		}

		return files[id];
	},

	_getFileStatus: function(id) {
		var self    = this;
		var file    = self._getFileById(id);
		return file.status;
	},

	_getUniqueId: function() {
		return this._fileList !== null ? this._fileList.length + 1 : 1;
	},

	_getErrorMessage : function(code, fileName) {
		var self    = this;
		var message = self.options.messages[code];

		function parse(name, replacement)
		{
			message = message.replace(name, replacement);
		}

		if (fileName !== null)
		{
			parse('{file}', self._formatFileName(fileName));
		}

		parse('{extensions}',   self.options.allowedExtensions.join(', '));
		parse('{sizeLimit}',    self._formatSize(self.options.sizeLimit));
		parse('{minSizeLimit}', self._formatSize(self.options.minSizeLimit));
		parse('{maxFilesDropped}', self.options.maxFilesDropped);

		return message;
	},

	_setFileStatus: function(id, status) {
		var self    = this;
		var file    = self._getFileById(id);
		file.status = status;

		if (!self._useFileList)
		{
			return;
		}

		file.elem.attr('class', status);
	},

	_addToList: function(id, fileName) {
		var self           = this;
		self._fileList     = self._fileList === null ? {} : self._fileList;
		self._fileList[id] = {
			name  : fileName,
			status: 'loading',
			elem  : null
		};

		if (!self._useFileList)
		{
			return;
		}

		var name    = $('<span class="name" />').text(self._formatFileName(fileName));
		var size    = $('<span class="size" />');
		var elem    = $('<li />').attr('id', 'fileId-' + id).addClass('loading');

		name.appendTo(elem);
		size.appendTo(elem);
		elem.appendTo(self.options.listElement);
		self._fileList[id].elem = elem;
		self.options.listElement.data('fileList', self._fileList);
	},

	_preventLeaveInProgress: function() {
		var self = this;

		$(window).on('beforeunload', function(e){
			if (!self._filesInProgress)
			{
				return;
			}

			var e = e || window.event;

			if (e)
			{
				e.returnValue = self.options.onLeave.apply(self);
			}

			return self.options.onLeave.apply(self);
		});
	},

	_isXHRUploadSupported : function() {
		var input  = document.createElement('input');
		input.type = 'file';

		return (
			'multiple' in input &&
			typeof File != "undefined" &&
			typeof (new XMLHttpRequest()).upload != "undefined" );
	},

	_isExtensionAllowed: function(fileName) {
		var ext     = (-1 !== fileName.indexOf('.')) ? fileName.replace(/.*[.]/, '').toLowerCase() : '';
		var allowed = this.options.allowedExtensions;

		if (allowed.length == 0)
		{
			return true;
		}

		for (var i=0; i<allowed.length; i++)
		{
			if (allowed[i].toLowerCase() == ext)
			{
				return true;
			}
		}

		return false;
	},

	_formatFileName: function(name) {
		if (name.length > 33)
		{
			name = name.slice(0, 19) + '...' + name.slice(-13);
		}

		return name;
	},

	_formatSize: function(bytes) {
		var i = -1;
		do
		{
			bytes = bytes / 1024;
			i++;
		}
		while (bytes > 99);

		return Math.max(bytes, 0.1).toFixed(1) + ['kB', 'MB', 'GB', 'TB', 'PB', 'EB'][i];
	},

	_log : function(message) {
		if (this.options.debug == true && window.console != undefined)
		{
			console.log('jQuery.fileuploader: ' + message);
		}
	}
});
})(jQuery);