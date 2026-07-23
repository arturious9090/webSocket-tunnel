import http from 'http'
import { URL } from 'url'
import WebSocket from 'ws'

const PORT = 8000
const WEB_SOCKET_URL = 'ws://localhost:8080'

async function request(url, method, headers, body) {
    return new Promise((resolve, reject) => {
        const req = http.request(url, { method }, (res) => {
            let data = ''
            res.on('data', (chunk) => {
                data += chunk
            })
            res.on('end', () => {
                resolve(data)
            })
        }).on('error', (err) => {
            reject(err)
        })
        req.setHeaders(headers)
        req.end(body)
    })
}

async function WsConnect(retryTime = 50) {
    const ws = new WebSocket(WEB_SOCKET_URL)

    return new Promise((resolve, reject) => {
        ws.once('open', () => {
            console.log('connected to', WEB_SOCKET_URL)
            resolve(ws)
        }).once('error', (error) => {
            if (error.name === 'AggregateError') {
                console.log('fail to connect next attempt in', retryTime * 2 / 1000, 's')
                if (retryTime > 100000) {
                    console.log('conection error')
                    process.exit(1)
                }
                setTimeout(WsConnect, retryTime, retryTime * 2)
            } else {
                console.log(error)
            }
        })
    })
}


async function main() {
    const socket = await WsConnect()

    const url = new URL('http://localhost:8000')
    
    const body = new Buffer.from('hello world!!')
    const headers = new Headers()
    headers.append('Content-Length', Buffer.byteLength(body))

    socket.on('message', (data) => {
        const rdata = JSON.parse(data)
        const method = rdata.method
        const url = rdata.url
        const headers = new Headers()
        console.log(url)
        for (const h in rdata.headers) {
            headers.append(h, rdata.headers[h])
        }
        const body = rdata.body
        const req = http.request('http://localhost:8000' + url, { method }, (res) => {
            let data = ''
            res.on('data', (chunk) => {
                data += chunk
            })
            res.on('end', () => {
                socket.send(data)
            })
        }).on('error', (err) => {
            console.log(err)
        })
        req.setHeaders(headers)
        req.end(body)
    })

}

main()
