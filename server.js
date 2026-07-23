import { WebSocketServer } from 'ws';
import readline from 'node:readline/promises';
import { createServer } from 'node:http';
import { TransferRequestObj } from './client.js';

const WEB_SERVER_PORT = 8081


function main() {
    const wss = new WebSocketServer({ port: 8080 });
    const server = createServer()

    wss.on('connection', (ws, req) => {
        console.log('new ws connection')
        server.on('request', (req, res) => {
            console.log('new', req.method, 'request on', req.url)
            req.pause()

            let data = ""
            req.on('data', (chunk) => { data += chunk })
            const tobj = new TransferRequestObj(req.url, req.method, req.headers, data)
            ws.send(JSON.stringify(tobj), (err) => {
                if (err) console.log(err);
            })
            let evdata = ''
            ws.addEventListener('message', (ev) => {
                evdata = ev.data
                req.resume()
            })
            req.on('end', () => {
                res.end(evdata)
            })    
        })
    })

    server.listen(WEB_SERVER_PORT, () => {
        console.log('сервер слушает на порту:', WEB_SERVER_PORT)
    })


}
main()

