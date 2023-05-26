#!/usr/bin/node

const http = require("http");
const fs = require('fs');
const pty = require('node-pty');
const WebSocket = require('ws');
const os = require("os");
const router = require('find-my-way')()

const master = 'eigg';
const endpoint = '/endpoint/tty/'
const host = '0.0.0.0';
const web_port = 80;
const socket_start = 3000;
const max_sockets = 12;
const links_dir = 'links';
const hostname = os.hostname();

var active_ports = new Set();
var active_consoles = {};
var unknown_devices = new Set();

// sync to master

function announce_to_master(){
    let data = {
        'action': 'announce',
        'host'  : hostname,
    };
    let data_encoded = JSON.stringify(data);
    let options = {
        host: master,
        path: endpoint,
        method: 'POST',
        headers: {
            'Content-Length': Buffer.byteLength(data_encoded),
            'Content-Type': 'application/json',
        },
    }
    let req = http.request(options, res => {
            let data = [];
            res.on('data', chunk => data.push(chunk));
            res.on('end',() => {
                if(res.statusCode == 201){
                    console.log(`announced presence to ${master}`);
                    sync_latest().then(
                        result => {},
                        error => {},
                    );
                }
            });
            res.on('error', () => console.log(`Error: unable to contact ${master}`));
        }
    )
    req.on('error', err => console.log(`Error: unable to contact ${master}`));
    req.write(data_encoded);
    req.end();
}

function get_remote_file(url){
    return new Promise((resolve, reject) => {
        http.get(url, res => {
            let data = [];
            res.on('data', chunk => {
                data.push(chunk);
            });
            res.on('end', () => {
                if(200 <= res.statusCode &&  res.statusCode < 300){
                    const files = Buffer.concat(data).toString();
                    resolve(files);
                }
                reject(res.statusCode);
            })
        }).on('error', err => {
            reject(err.message);
        });
    })
}

function sync_latest(){
    return new Promise((resolve, reject) => {
        serial_files = get_remote_file(`http://${master}${endpoint}serials/`);
        serial_files.then(
            result => {
                responses = [];
                result = JSON.parse(result);
                result.forEach(filename => {
                    response = get_remote_file(`http://${master}${endpoint}serials/${filename}`);
                    responses.push(response);
                    response.then(
                        data => {
                            fs.writeFileSync(`serials/${filename}`, data);
                            console.log(`Updated ${filename}`);
                        },
                        error => {reject(`${error} unable to copy serials from host`)}
                    )
                });
                Promise.all(responses).then((values) => {
                    resolve('All files synced successfully');
                });
            },
            error => {reject(`${error} unable to find serial filenames`)}
        )
    })
}
announce_to_master();

//Serial monitoring

fs.readdir(links_dir, (err, files) => {
    system_start = Date.now() - (os.uptime() * 1000);
    files.forEach(filename => {
        stats = fs.lstatSync(`${links_dir}/${filename}`)
        if(stats.mtimeMs < system_start){
            console.log(`Removing stale symlink: ${filename}`);
            fs.unlinkSync(`${links_dir}/${filename}`);
            return
        }
        if(is_unknown(filename)){
            add_unknown(filename);
            return
        }
        add_socket(filename);
    });
    fs.watch(links_dir, (event, filename) => {
        if (fs.existsSync(`${links_dir}/${filename}`)) {
            if(is_unknown(filename)){
                add_unknown(filename);
                return
            }
            add_socket(filename);
            return
        }
        remove_socket(filename);
    });
});

function is_unknown(filename){
    ext = filename.split('.').pop();
    if(ext == 'unknown'){
        return true;
    }
    return false
}

function add_unknown(filename){
    serial = filename.split('.')[0]
    console.log(`unknown device found with serial ${serial}`);
    unknown_devices.add(serial);
}

//WebSocket

function add_socket(filename){
    console.log('add_socket');
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
    console.log(`remove_socket ${device}`);
    if (device in active_consoles) {
        console.log(`${device} disconnected closing sockets`)
        active_ports.delete(active_consoles[device].port);
        active_consoles[device].wss.clients.forEach(ws => {
            ws.close()
        });
        active_consoles[device].wss.close();
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
})

router.get('/consoles', (req, res, params) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    fs.createReadStream('static/consoles.html').pipe(res);
})

router.get('/consoles/connected', (req, res, params) => {
    payload = {};
    payload.known = [];
    payload.unknown = [...unknown_devices];
    payload.master = master;
    for(const [name, item] of Object.entries(active_consoles)) {
        temp = {}
        temp.name = name
        temp.port = item.port
        temp.conns = item.sockets.size
        payload.known.push(temp);
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write(JSON.stringify(payload));
    res.end();
})

router.get('/static/:filename', (req, res, params) => {
    filename = params['filename'];
    console.log(filename);
    if (!fs.existsSync(`static/${filename}`)) {
        console.log(`${filename} doesn't exists`);
        res.writeHead(404);
        res.end();
        return;
    }
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

router.get('/consoles/sync', (req, res, params) => {
    console.log(`serial sync requested`);
    sync_latest().then(
        result => {
            res.writeHead(200, { 'content-type': 'text/plain' });
            res.write('sync success');
            res.end();
        },
        error => {
            res.writeHead(500, { 'content-type': 'text/plain' });
            res.write(`sync failed ${error}`);
            res.end();
        }
    );
})

const server = http.createServer((req, res) => {
    router.lookup(req, res)
})

server.listen(web_port, host, () => {
    console.log(`Server is running on http://${host}:${web_port}`);
});
