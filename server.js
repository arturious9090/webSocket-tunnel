import { WebSocket, WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { v4 as uuidv4 } from 'uuid'
import * as readLine from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { MessageType } from './shared.js';
import { log } from 'console'

const WEB_SERVER_PORT = 80
const WEB_SOCKET_PORT = 8080

const avalibleHosts = [
    'examplee-domain.com',
    'example-domain.com'
]

const messagesHandler = (data, wsId) => {
    console.log(wsId, ':', data.toString())
}

async function main() {
    const rl = readLine.createInterface({ input, output, prompt: '> ' })
    const wss = new WebSocketServer({ port: WEB_SOCKET_PORT });
    const server = createServer()
    const clients = new Map()
    const clientsHosts = new Map()

    wss.on('connection', (ws, req) => {

        const clientId = uuidv4()
        ws.id = clientId
        clients.set(ws.id, ws)

        const host = avalibleHosts.pop()
        clientsHosts.set(host, ws.id)
        ws.host = host

        console.log('new ws connection', clientId)

        ws.on('message', (data) => {
            const messsage = JSON.parse(data.toString())
            if (messsage.requestType === 'SYSTEM') {
                if (messsage.request === 'AVALIBLE_HOSTS') {
                    log('AVALIBLE_HOSTS')
                    ws.send(new Buffer.from(JSON.stringify(avalibleHosts)))
                }
            } else {
                log('USER')
            }
        })

        ws.on('close', (code, reason) => {
            console.log('connection', ws.id, 'closed')
            avalibleHosts.push(ws.host)
            clients.delete(ws.id)
        })
    })

    function createHttpReuest({method, url, headers, body}){
        return {
            type: MessageType.HTTP_REQUEST,
            method,
            url,
            body: body || null
        }
    }

    server.on('request', (req, res) => {
        const host = req.headers.host
        const ws = clients.get(clientsHosts.get(host))
        if (ws instanceof WebSocket) {
            const httpRequest = createHttpReuest(req.method, req.url, req.headers, req.body)
            ws.send(new Buffer.from(JSON.stringify(httpRequest)))
            const httpResponse = new Promise ((resolve, reject )=>{
                ws.once('message', (data)=>{
                    resolve(JSON.parse(data.toString()))
                }).once('error', (error)=> {
                    reject(error)
                })
            })
            await httpResponse
            log(httpResponse)
        }
        res.writeHead(200, `{Content-Type: text/plain}`)
        res.end('OK')
    })

    server.listen(WEB_SERVER_PORT, () => {
        console.log('сервер слушает на порту:', WEB_SERVER_PORT)
    })

}
main()

