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