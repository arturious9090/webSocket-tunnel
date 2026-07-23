import { createServer } from "node:http"
import * as fs from "node:fs/promises"
import path from "node:path"
function log(data) { console.log(data) }

const server = createServer()

server.on('request', (req, res) => {
    console.log('new', req.method, 'request on', req.url)
    req.on('data', (chunk) => { log(chunk.toString()) })
    req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'text/plain', 'system-header': 'systemInfo' });
        res.write("OKey")
        res.end()
    })
})

server.listen('8000', () => {
    console.log('server is listening')
})