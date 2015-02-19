'use strict'

var fs		= require('fs')
  , util	= require('util')

// 1. read for install commad
//
// application install-daemon

// 2. read logs filepath options
//
// --stdout=/var/log/app/stdout.log
// --stderr=/var/log/app/stderr.log

// 3. --env=trunk
//

var env_name = null

// mysql:x:105
var re_name = /^([a-zA-Z]+)\:x\:(\d+)/
function getId(content, name) {
	var lines = content.split('\n'), a
	for(var i = 0, l = lines.length; i < l; i++) {
		if(a = re_name.exec(lines[i])) {
			if(a[1] === name) {
				return parseInt(a[2])
			}
		}
	}
	return -1
}

function getUserId(user) {
	var c = '' + fs.readFileSync('/etc/passwd')
	var id = getId(c, user)
	if(id === -1) {
		console.log("can't find user id for user " + user)
		process.exit()
	}
	console.log('user ' + user + ' ' + id)
	return id
}

function getGroupId(group) {
	var c = '' + fs.readFileSync('/etc/group')
	var id = getId(c, group)
	if(id === -1) {
		console.log("can't find group id for group " + group)
		process.exit()
	}
	console.log('group ' + group + ' ' + id)
	return id
}

var re_var = /\%([a-zA-Z\d_-]+)\%/

var json, config_path = null
function loadConfig() {

	var path = config_path ? config_path : (process.cwd() + '/daemon' + ( env_name ? '.' + env_name : '' ) + '.json')
	if(!fs.existsSync(path)) {
		console.log("can't find daemon.json in application dir")
		process.exit()
	}

	var content = '' + fs.readFileSync(path)
	json = null
	try {
		json = JSON.parse(content)
	}
	catch(e) {
		json = null
	}
	if(null === json) {
		console.log("daemon.json not valid json")
		process.exit()
	}

}


var stdout = null, stderr = null
for(var i = 0, c = process.argv, l = c.length; i < l; i++) {
	var item = c[i]
	if(item === 'install-daemon') {

		// get config from ./daemon.json

		// 1. install /etc/init.d/appname
		// 2. install logrotate script

		console.log('installing daemon')

		loadConfig()
		var content = '' + fs.readFileSync(__dirname + '/init_script')

		// console.log('cwd ' + process.cwd())

		var logsdir = json.logs_dir ? json.logs_dir : '/var/log/' + json.name

		var params = {
		    app_name: json.name,
			daemon_script_path: process.cwd() + '/' + json.name,
			app_title: json.title,
			app_user: json.user,
			app_group: json.group,
			config_path: process.cwd() + '/daemon.json',
			stdout: logsdir + '/stdout.log',
			stderr: logsdir + '/stderr.log',
			node_bin_dir: json.node_bin_dir ? json.node_bin_dir : '/bin',
			env_config: "",
			env: env_name ? '--env=' + env_name : ''
		}

		if(json.env_config) {
			// #[ -r /etc/default/$INIT_SCRIPT_NAME ] && . /etc/default/$INIT_SCRIPT_NAME
			var p = process.cwd() + '/' + json.env_config
			params.env_config = '[ -r ' + p + ' ] && . ' + p
		}

		if(!fs.existsSync(logsdir)) {
			fs.mkdirSync(logsdir, 488)
			fs.chmodSync(logsdir, 488)
			fs.chownSync(logsdir, getUserId(json.user), getGroupId(json.group))
		}
		var a
		while(a = re_var.exec(content)) {
			content = content.substr(0, a.index) + params[a[1]] + content.substr(a.index + a[0].length)
		}

		var path = '/etc/init.d/' + json.name
		if(fs.existsSync(path)) {
			fs.unlinkSync(path)
		}
		fs.writeFileSync(path, content, { mode: 511 })
		fs.chmodSync(path, 484)
		console.log('init script installed')

		var content = '' + fs.readFileSync(__dirname + '/logrotate')
		var a
		while(a = re_var.exec(content)) {
			content = content.substr(0, a.index) + params[a[1]] + content.substr(a.index + a[0].length)
		}

		var path = '/etc/logrotate.d/' + json.name
		if(fs.existsSync(path)) {
			fs.unlinkSync(path)
		}
		fs.writeFileSync(path, content, { mode: 420 })
		fs.chmodSync(path, 420)
		console.log('logrotate script installed')

		process.exit()
	}
	// --config_path=/var/log/app/daemon.json
	else if(item.length > 14 && item.substr(0, 14) === '--config_path=') {
		config_path = item.substr(14)
	}
	// --stdout=/var/log/app/stdout.log
	else if(item.length > 9 && item.substr(0, 9) === '--stdout=') {
		stdout = item.substr(9)
	}
	// --stderr=/var/log/app/stderr.log
	else if(item.length > 9 && item.substr(0, 9) === '--stderr=') {
		stderr = item.substr(9)
	}
	// --env=trunk
	else if(item.length > 6 && item.substr(0, 6) === '--env=') {
		env_name = item.substr(6)
	}
}

loadConfig()
process.title = json.title

if(!stdout) {
	stdout = process.cwd() + '/stdout.log'
}

if(!stderr) {
	stderr = process.cwd() + '/stderr.log'
}



function LogFile(filename) {
	this.filename = filename
	this.pid = process.pid
	this.log_fh = fs.openSync(filename, 'a')
	LogFile.prototype.items.push(this)
	this.log = this.log.bind(this)
	// console.log('open log file ' + filename)
}

LogFile.prototype = {

    items: [ ],

	format2: function(n) {
		if(n < 10) return '0' + n
		return n
	},

	log: function(message) {
		var d = new Date()
		var datestring = '' + d.getFullYear() + '-' + this.format2(d.getMonth()) + '-' + this.format2(d.getDate()) + ' ' + this.format2(d.getHours()) + ':' + this.format2(d.getMinutes()) + ':' + this.format2(d.getSeconds())
		fs.writeSync(this.log_fh, datestring + ' [' + this.pid + '] ' + message + "\n")
	},

	onSigHub: function() {
		for(var i = 0, c = this.items, l = c.length; i < l; i++) {
			c[i].reopen()
		}
	},

	reopen: function() {
		if(!fs.existsSync(this.filename) || fs.statSync(this.filename).size < 1) {
		    this.log('close log')
			fs.closeSync(this.log_fh)
			this.log_fh = fs.openSync(this.filename, 'a')
	    	this.log('logrotating')
		}
	}
}

process.on('SIGHUP', LogFile.prototype.onSigHub.bind(LogFile.prototype))

console.log = (new LogFile(stdout)).log
console.dir = function(p) { console.log(util.inspect(p,{depth:null})) }
process.stderr.write = (new LogFile(stderr)).log

module.exports = { }