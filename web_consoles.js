#!/usr/bin/node

const http = require("http");
const fs = require('fs');
const pty = require('node-pty');
const WebSocket = require('ws');
const os = require("os");
const router = require('find-my-way')()


const host = '0.0.0.0';
const web_port = 80;
const socket_start = 3000;
const max_sockets = 12
const links_dir = 'links'
const hostname = os.hostname;

var active_ports = new Set();
var active_consoles = {}

//Serial monitoring

fs.readdir(links_dir, (err, files) => {
    system_start = Date.now() - (os.uptime() * 1000);
    files.forEach(filename => {
        stats = fs.lstatSync(`${links_dir}/${filename}`)
        if(stats.mtimeMs < system_start){
            console.log(`Removing stale symlink`);
            fs.unlinkSync(`${links_dir}/${filename}`)
            return
        }
        add_socket(filename);
    });
    fs.watch(links_dir, (event, filename) => {
        if (fs.existsSync(`${links_dir}/${filename}`)) {
            add_socket(filename);
            return
        }
        remove_socket(filename);
    })
});

//WebSocket

function add_socket(filename){
    for (port = socket_start; port < socket_start + max_sockets; port++) {
        if ( ! active_ports.has(port) ) {
            console.log(`New Serial device ${filename} port: ${port}`)
            active_ports.add(port);
            active_consoles[filename] = {};
            active_consoles[filename].name = filename;
            active_consoles[filename].port = port;
            active_consoles[filename].pty = null;
            active_consoles[filename].pty_initialized = false;
            active_consoles[filename].sockets = new Set();
            active_consoles[filename].wss = new WebSocket.Server({ port: port });
            init_socket(active_consoles[filename]);
            return
        }
    }
    console.error('No sockets left');
}

function remove_socket(device){
    if (device in active_consoles) {
        console.log(`${device} disconnected closing sockets`)
        active_ports.delete(active_consoles[device].port);
        active_consoles[device].wss.clients.forEach(ws => {
            ws.close()
        });
        delete active_consoles[device];
    }
}

function init_socket(con){
    con.wss.on('connection', ws => {
        console.log(`[New connection]::${con.name} total: ${con.wss.clients.size}`);
        con.sockets.add(ws);

        if(!con.pty_initialized){
            console.log(`initializing pty for ${con.name}`);
            init_pty(con);
            con.pty_initialized = true
        }

        ws.on('message', command => {
            con.pty.write(command);
        })

        ws.on('close', function () {
            console.log(`[Lost connection]::${con.name} total: ${con.wss.clients.size}`);
            con.sockets.delete(ws);
            delete ws;
        });

        ws.on('error', console.error);
    })
}
function init_pty(con){
    con.pty = pty.spawn('bash', [], {
        name: 'xterm-color',
        cols: 150,
        rows: 80,
        env: process.env,
    });
    con.pty.write(`screen -x ${con.name}\n`);
    con.pty.on('data', function (data) {
        con.sockets.forEach(ws => {
            async_send(ws);
        })
        async function async_send(socket){
            socket.send(data);
        }
    });

}

//Webserver

MIME_MAP = {}
MIME_MAP.css = { 'content-type': 'text/css' }
MIME_MAP.js = { 'content-type': 'text/javascript' }


router.get('/', (req, res, params) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    fs.createReadStream('static/index.html').pipe(res);
    //fs.createReadStream('static/consoles.html').pipe(res);
})

router.get('/consoles', (req, res, params) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    //fs.createReadStream('static/index.html').pipe(res);
    fs.createReadStream('static/consoles.html').pipe(res);
})

router.get('/consoles/active', (req, res, params) => {
    var result = JSON.stringify(active_consoles, function(key, val) {
        excluded = ['wss', 'pty', 'pty_initialized', 'sockets'];
        if(excluded.indexOf(key) == -1){
            return val;
        }
    });
    res.writeHead(200, { 'content-type': 'text/html' });
    res.write(result);
    res.end();
})

router.get('/static/:filename', (req, res, params) => {
    filename = params['filename'];
    console.log(filename);
    if (!fs.existsSync(`static/${filename}`)) {
        console.log('file doesnt exists');
        res.writeHead(404);
        res.end();
        return;
    }
    console.log('after');
    ext = filename.split('.').pop();
    if(ext in MIME_MAP){
        res.writeHead(200, MIME_MAP[ext]);
    }
    fs.createReadStream(`static/${filename}`).pipe(res);
})

router.get('/cgi-bin/showconsoles.cgi', (req, res, params) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.write(`Consoles attached to ${hostname}\n`);
    res.write(`${Date().toLocaleString()}\n`);
    for (const device in active_consoles) {
        res.write(`tty_${device} connected\n`);
    }
    res.end();
})

const server = http.createServer((req, res) => {
    router.lookup(req, res)
})

server.listen(web_port, host, () => {
    console.log(`Server is running on http://${host}:${web_port}`);
});
