const http = require("http");
const fs = require('fs');
const pty = require('node-pty');
const WebSocket = require('ws');


const host = '0.0.0.0';
const web_port = 80;


const socket_start = 3000;
const max_sockets = 10
const verbose = true;
const links_dir = 'links'

const server = http.createServer();
const wss = new WebSocket.Server({ port: 6060 });

var active_ports = new Set();
var active_consoles = {}

/*
var ptyProcess = pty.spawn('bash', [], {
    name: 'xterm-color',
    //   cwd: process.env.HOME,
    env: process.env,
});

wss.on('connection', ws => {
    console.log("new session")
    ptyProcess.write('screen -x test1\n');
    ws.on('message', command => {
        console.log(`new message ${command}`)
        ptyProcess.write(command);
    })

    ptyProcess.on('data', function (data) {
        console.log("new data")
        console.log(data.length)
        ws.send(data)
        //console.log(data);
    });
})
*/

//File

function add_socket(filename){
    for (port = socket_start; port < socket_start + max_sockets; port++) {
        console.log(`trying  port ${port}`);
        if ( ! active_ports.has(port) ) {
            active_ports.add(port);
            active_consoles[filename] = {};
            active_consoles[filename].port = port;
            active_consoles[filename].socket = new WebSocket.Server({ port: port });
            return
        }
    }
    console.error('No sockets left');
}

function remove_socket(filename){
    if (filename in active_consoles) {
        active_ports.delete(active_consoles[filename].port);
        active_consoles[filename].socket.close()
        delete active_consoles[filename]
    }
}

fs.readdir(links_dir, (err, files) => {
    files.forEach(filename => {
        add_socket(filename);
    });
    console.log(active_consoles);
});

fs.watch(links_dir, (event, filename) => {
    if (fs.existsSync(`${links_dir}/${filename}`)) {
        add_socket(filename);
        console.log(active_consoles);
        return
    }
    remove_socket(filename);
    console.log(active_consoles);
})

//Socket

//Webserver

server.on('request', (request, response) => {
    if(request.socket.remoteAddress == '10.12.196.15'){
        //old multimon hush
        return;
    }
    if(verbose){
        console.log(`Request ${request.method} ${request.url}`);
    }
    switch (request.url) {
        case "/":
            response.writeHead(200, { 'content-type': 'text/html' });
            fs.createReadStream('static/index.html').pipe(response);
            break;

        case "/consoles":
            response.writeHead(200, { 'content-type': 'text/html' });
            fs.createReadStream('static/consoles.html').pipe(response);
            break;

        default:
            response.writeHead(404, { 'content-type': 'text/html' });
            response.write('404 :/');
            response.end();
    }
});

server.listen(web_port, host, () => {
    console.log(`Server is running on http://${host}:${web_port}`);
});