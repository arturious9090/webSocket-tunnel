import { log } from 'console'
import http from 'http'
import { URL } from 'url'
import WebSocket from 'ws'

const PORT = 8000
const WEB_SOCKET_URL = 'ws://localhost:8080'
const HTTP_SERVER_HOST = 'http://localhost:8000'

class WebSockerReconnectWrapper {
    constructor(address, protocols, options, retryTime) {
        this._ws = undefined
        this._activeListeners = { on: new Map(), once: new Map() }
        this.address = address
        this.protocols = protocols
        this.options = options
        this.retryTime = retryTime || 500
        this.connect()
        this._ready
        this._maxRetrys = 50
        this._retryCount = 0
    }
    connect() {
        const ws = new WebSocket(this.address, this.protocols, this.options)
        this._ready = new Promise((resolve) => {
            ws.once('open', () => {
                for (const [eventName, events] of this._activeListeners.on) {
                    for (const e of events) {
                        ws.on(eventName, e) // Сделать коректную обработку одноразовых событий 
                    }
                }
                for (const [eventName, events] of this._activeListeners.once) {
                    for (const e of events) {
                        ws.once(eventName, e) // Сделать коректную обработку одноразовых событий 
                    }
                }
                log('conected')
                this._retryCount = 0
                this._ws = ws
                resolve()
            })
        })
        ws.once('error', (error) => {
            if (error.name !== 'AggregateError') {
                throw error
            }
        }).once('close', (code, reson) => {
            if (this._retryCount >= this._maxRetrys) {
                throw new Error('connection error')
            }
            this._retryCount += 1
            setTimeout(() => this.connect(), this.retryTime)
        })
    }

    async on(event, handler) {
        await this._ready
        try {
            this._activeListeners.on.get(event).push(handler)
        } catch (error) {
            this._activeListeners.on.set(event, [handler])
        }
        this._ws.on(event, handler)
    }

    async once(event, handler) {
        await this._ready
        try {
            this._activeListeners.once.get(event).push(handler)
        } catch (error) {
            this._activeListeners.once.set(event, [handler])
        }
        this._ws.once(event, handler)
    }



    async send(data) {
        await this._ready
        this._ws.send(data)
    }
}

async function main() {

    const ws = new WebSockerReconnectWrapper(WEB_SOCKET_URL)
    ws.on('message', (data) => {
        const httpRequest = JSON.parse(data.toString())
        log(httpRequest)
    })

}


// const url = new URL('http://localhost:8000')
// const body = new Buffer.from('hello world!!')
// const headers = new Headers()
// headers.append('Content-Length', Buffer.byteLength(body))

// socket.on('message', (data) => {
//     const rdata = JSON.parse(data)
//     const method = rdata.method
//     const url = rdata.url
//     const headers = new Headers()
//     console.log(url)
//     for (const h in rdata.headers) {
//         headers.append(h, rdata.headers[h])
//     }
//     const body = rdata.body
//     const req = http.request('http://localhost:8000' + url, { method }, (res) => {
//         let data = ''
//         res.on('data', (chunk) => {
//             data += chunk
//         })
//         res.on('end', () => {
//             socket.send(data)
//         })
//     }).on('error', (err) => {
//         console.log(err)
//     })
//     req.setHeaders(headers)
//     req.end(body)
// })
main()
