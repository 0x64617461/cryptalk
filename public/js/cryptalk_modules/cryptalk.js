// Main cryptalk module. Will be called by bootstrap.js when the DOM is ready to interact with.
define('cryptalk', {
	data: {
		// If no host is given it will default to localhost.
		host: ''
	},
	compiles: ['$'],
	requires: ['templates']
}, function ($, requires, data) {
	var socket,
		key,
		room,
		hash,
		nick,

		// Collection of DOM components
		components = {
			chat: 	$('#chat'),
			input: 	$('#input')
		},

		// Shortcut
		templates = requires.templates,

		// Adds a new message to the DOM
		post = function (type, text, clearChat, clearBuffer, nick) {
			var tpl = templates.post[type],
				post = $.template(tpl, text && {
					text: text,
					nick: nick
				});

			// Always clear the input after a post
			if (clearBuffer) {
				components.input[0].value = '';
			}

			// Append the post to the chat DOM element
			components.chat[clearChat ? 'html' : 'append'](post);
		},

		// Chat related commands
		commands = {
			help: function () {
				post('info', templates.help);
			},

			clear: function () {
				components.chat.html('');
				components.input[0].value = '';
			},

			leave: function () {
				if( room ) {
					socket.emit('room:leave', room);
				} else {
					post('error', templates.messages.leave_from_nowhere);
				}
				
			},

			key: function (payload) {
				// Make sure the key meets the length requirements
				if (payload.length < 8) {
					return post('error', templates.messages.key_weak);
				}

				// Set key
				key = payload;

				// Inform that the key has been set
				post('info', (room ? templates.messages.key_ok_ready : templates.messages.key_ok_but_no_room));
			},

			nick: function (payload) {
				// Make sure the nick meets the length requirements
				if (payload.length < 2) {
					return post('error', templates.messages.nick_short);
				}

				// Set nick
				nick = payload;

				// Inform that the key has been set
				post('info', $.template(templates.messages.nick_set, { nick: nick}));
			},

			join: function (payload) {
				return (
					room
						? post('error', $.template(templates.messages.already_in_room, { roomName: room}))
						: socket.emit('room:join', payload)
				);
			},

			generate: function (payload) {
				return (
					room
						? post('error', $.template(templates.messages.already_in_room, { roomName: room}))
						: socket.emit('room:generate')
				);
			}
		},

		// Handler for the document`s keyDown-event.
		onKeyDown = function (e) {
			var buffer,
				parts,
				payload,
				command;

			// The Document object is bound to this element.
			// If the active element is not the input, focus on it and exit the function.
			if (components.input[0] !== $.activeElement()) {
				return components.input.focus();
			}

			// Return immediatly if the buffer is empty or if the hit key was not <enter>
			if (e.keyCode !== 13 || !(buffer = components.input[0].value)) {
				return;
			}

			// Handle command
			if (buffer[0] === '/') {
				parts = $.ssplit(buffer.slice(1), ' ');
				command = parts[0];
				payload = parts[1];

				// Check that there is an handler for this command
				if (!commands[command]) {
					return post('error', $.template(templates.messages.unrecognized_command, { commandName: command }));
				}

				// Execute command handler
				commands[command](payload);
			} else /* Handle ordinary message */ {
				// Make sure that the users has joined a room
				if (!room) {
					return post('error', templates.messages.msg_no_room);
				}

				// And that a valid key is set
				if (!key) {
					return post('error', templates.messages.msg_no_key);
				}

				// Before sending the message.
				// Encrypt message using room UUID as salt and key as pepper.
				socket.emit('message:send', {
					room: room,
					msg: $.AES.encrypt(buffer, room + key).toString(),
					nick: nick
				});

				// Adn the the buffer
				components.input[0].value = '';
			}
		};

	// Connect to server
	socket = $.Websocket.connect(data.host);

	// Bind socket events
	socket
		.on('connect', function () {
			$(document).on('keydown', onKeyDown);
			components.input.focus();
		})

		.on('room:generated', function (data) {
			socket.emit('room:join', data);
		})

		.on('room:joined', function (data) {
			room = data;
			post('info', $.template(templates.messages.joined_room, { roomName: room }));
		})

		.on('room:left', function () {
			post('info', $.template(templates.messages.left_room, { roomName: room }));
			room = false;
		})

		.on('message:send', function (data) {
			var decrypted = $.AES.decrypt(data.msg, room + key),
				sanitized = $.escapeHtml(decrypted),
				nick = 		(data.nick == undefined || !data.nick ) ? templates.default_nick : $.escapeHtml(data.nick);

			if (!decrypted) {
				post('error', templates.messages.unable_to_decrypt);
			} else {
				// Post the message, but do not clear either the chat nor the buffer.
				post('message', sanitized, false, false, nick);
			}
		})

		.on('message:server', function (data) {
			var sanitized = $.escapeHtml(data);
			post('server', data);
		});

	// Post the help/welcome message
	post('info', templates.help, true);

	// It's possible to provide room and key using the hashtag.
	// The room and key is then seperated by semicolon (room:key).
	// If there is no semicolon present, the complete hash will be treated as the room name and the key has to be set manually.
	if (hash = window.location.hash) {
		parts = hash.slice(1).split(':');

		parts[0] && commands.join(parts[0]);
		parts[1] && commands.key(parts[1]);
	}
});