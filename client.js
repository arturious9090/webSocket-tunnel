import http, { WebSocket } from 'http'
import { URL } from 'url'

const PORT = 8000
const WEB_SOCKET_URL = 'ws://localhost:8080'

export class TransferRequestObj {
    /**
     * 
     * @param {string | URL} url 
     * @param { 'GET' | 'POST' | 'PUT' | 'DELETE'} method 
     * @param {Headers} headers 
     * @param {Buffer} body 
     */
    constructor(
        url,
        method,
        headers,
        body
    ) {
        this.url = url;
        this.method = method;
        this.headers = headers;
        this.body = body;
    }
}

// const tobj = new TransferRequestObj(url, 'GET', { foo: 'bar', bar: 'baz' }, new Buffer.from('hello world!'))


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

async function main() {
    const socket = new WebSocket(WEB_SOCKET_URL)
    const body = new Buffer.from('hello world!!')
    const url = new URL('http://localhost:8000')
    const headers = new Headers()

    headers.append('Content-Length', Buffer.byteLength(body))

    socket.addEventListener('open', event => {
        console.log('conected')
    })

    socket.addEventListener('message', (ev) => {
        const rdata = JSON.parse(ev.data)
        const method = rdata.method
        const url = rdata.url
        const headers =  new Headers()
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

await main()
