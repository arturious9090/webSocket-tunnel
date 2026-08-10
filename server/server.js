import { WebSocket, WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { v4 as uuidv4 } from 'uuid'
import * as readLine from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import { log } from 'console'
import { DatabaseSync } from 'node:sqlite';
import express from 'express'

const WEB_SERVER_PORT = 80
const WEB_SOCKET_PORT = 8080

const avalibleHosts = [
    'examplee-domain.com',
    'example-domain.com'
]

const messagesHandler = (data, wsId) => {
    console.log(wsId, ':', data.toString())
}

function createHttpReuest({ method, url, headers, body }) {
    return {
        type: 'HTTP_REQUEST',
        method,
        url,
        headers,
        body: body || null
    }
}

function main() {
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

        console.log('new ws connection', clientId, host)

        ws.on('message', (data) => {
            log(data.toString())
        })

        ws.on('close', (code, reason) => {
            console.log('connection', ws.id, 'closed')
            avalibleHosts.push(ws.host)
            clients.delete(ws.id)
        })
    })

    server.on('request', async (req, res) => {
        // Берем хост запроса 
        const host = req.headers.host
        // Ищем вебсокет для этого хоста
        const ws = clients.get(clientsHosts.get(host))
        if (ws instanceof WebSocket) {
            // Создаем обьект для передачи данных звпроса 
            const httpRequest = createHttpReuest({ method: req.method, url: req.url, headers: req.headers, body: req.body })
            // Отправляем вебсокету
            ws.send(new Buffer.from(JSON.stringify(httpRequest)))
            // Ждем ответа от клиентского вебсокета. 
            const httpResponse = await new Promise((resolve, reject) => {
                ws.once('message', (data) => {
                    resolve(JSON.parse(data.toString()))
                }).once('error', (error) => {
                    reject(error)
                })
            })
            log(httpResponse)
        } else {
            log('ws is not instence of websocket')
            res.end('error')
        }
        res.end('OK')
    })

    server.listen(WEB_SERVER_PORT, () => {
        console.log('сервер слушает на порту:', WEB_SERVER_PORT)
    })

}
main()

