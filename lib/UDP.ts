import { PassThrough } from 'stream';
import { BetterPortOptions, BetterPortI, BetterPortType } from './index';
import * as dgram from 'dgram';

export type BetterUDPPortOptions = BetterPortOptions & dgram.SocketOptions & {
    ip?: string | string[] | undefined; //The IP address or addresses to send/listen to. If undefined will listen for clients to connect to us, then will also send to them
    bindAddress?: string | undefined; //The address to bind to if required
    recPort?: number; // The port to listen on
    sendPort?: number; // The port to send to
}

export class UDP implements BetterPortI {
    portType: string = BetterPortType.UDP;
    port: dgram.Socket | undefined;
    options: BetterUDPPortOptions;
    connected: boolean = false;
    clients: { ip: string, port: number | undefined }[] = [];
    passThough: PassThrough;
    currentRecPort: number | undefined;
    get isOpen(): boolean {
        return this.port != undefined && this.connected;
    }
    get path(): string | undefined {
        var ip = this.options.ip;
        if (Array.isArray(ip)) { ip = `[${ip.join(",")}]`; }
        return `${this.options.type}://${ip ? ip : ""}:${this.sendPort}:${this.recPort}`
    }
    get writable(): boolean {
        return this.isOpen;
    }
    get baudRate(): number {
        return 0;
    }
    get recPort(): number {
        return this.currentRecPort || 0;
    }
    get sendPort(): number {
        return this.options.sendPort || 0;
    }
    get ip(): string | string[] | undefined {
        return this.options.ip;
    }
    get type(): "udp4" | "udp6" | undefined {
        return this.options.type;
    }
    get bindAddress(): string | undefined {
        return this.options.bindAddress;
    }
    constructor(options: BetterUDPPortOptions) {
        if (typeof options.ip == "string") {
            this.clients = [{
                ip: options.ip,
                port: options.sendPort
            }];
        }
        else if (Array.isArray(options.ip)) {
            for (var i in options.ip) {
                this.clients.push({
                    ip: options.ip[i],
                    port: options.sendPort
                });
            }
        }

        if (!options.type) { options.type = "udp4" }
        this.passThough = new PassThrough();
        this.options = options;
    }

    portExists(): Promise<boolean> {
        var self = this;
        return new Promise(async (resolve, reject) => {
            //In the future maybe we can do a ping to the ip, for now just say it does exist
            resolve(true);
        });
    }
    portOpen(): boolean {
        return this.isOpen;
    }
    openPort(openCb: () => void, closeCb: () => void, errorCb: (err: any) => void, dataCb: (data: any) => void): Promise<void> {
        var self = this;
        return new Promise(async (resolve, reject) => {
            self.port = dgram.createSocket(self.options)
            self.port.once("listening", async () => { await openCb(); });
            self.port.once("connect", async () => { await openCb(); });
            self.port.on("error", async (err) => { await errorCb(err); });
            self.port.on("message", async (data: any, rinfo: dgram.RemoteInfo) => {
                var found = false;
                for (var i in self.clients) {
                    if (self.clients[i].ip == rinfo.address) {
                        if (self.clients[i].port == undefined) { self.clients[i].port = rinfo.port; }
                        found = true;
                        break;
                    }
                }

                //If we were passed no clients then we let the clients connect to us
                if (self.options.ip == undefined) {
                    if (!found) {
                        self.clients.push({ ip: rinfo.address, port: rinfo.port });
                        found = true;
                    }
                }

                //Check if the client is in the list of clients
                if (found == true) {
                    self.passThough.write(data);
                    await dataCb(data);
                }
            });
            self.port.once("close", async () => { await closeCb(); });

            //Bind to a port
            self.port.bind(self.options.recPort, self.options.bindAddress, () => {
                self.connected = true;
                self.currentRecPort = self.port?.address().port;
                resolve();
            });
        });
    }
    closePort(disconnectError?: Error): Promise<void> {
        var self = this;
        return new Promise(async (resolve, reject) => {
            //Destroy the old port if it exists
            if (!self.port) { resolve(); return; }

            var destroy = async function () {
                if (self.options.ip == undefined) { self.clients = []; } // Clear out any clients
                self.passThough = new PassThrough();
                self.port?.removeAllListeners();
                self.port?.unref();
                self.port = undefined;
                self.currentRecPort = undefined;
                await new Promise((resolve) => { setTimeout(resolve, 1000); }); // Wait a second before resolving to make sure the port is actually closed
                resolve();
            }

            if (self.connected == false) { await destroy(); return; }

            self.connected = false;
            self.port.close(async () => { await destroy(); });
        });
    }
    write(data: any, encoding?: any, callback?: any): boolean {
        if (!this.port) { if (callback) { callback("Port does not exist"); } return false; }
        if (this.isOpen == false) { if (callback) { callback("Not open"); } return false; }
        if (this.clients.length == 0) { if (callback) { callback("No clients to send to"); } return false; }

        //Send it!
        for (var i in this.clients) {
            if (this.clients[i] && this.clients[i].ip) {
                var port = this.options.sendPort || this.clients[i].port;
                if (port) {
                    this.port.send(data, port, this.clients[i].ip, (error: Error | null | undefined) => {
                        if (callback) { callback(error == null ? undefined : error); }
                    });
                }
            }
        }
        return true;
    }
    flush(): Promise<void> {
        var self = this;
        return new Promise((resolve, reject) => {
            //There is no flush for UDP so just resolve
            resolve();
        })
    }
    pipe<T extends NodeJS.WritableStream>(destination: T, options?: { end?: boolean | undefined; } | undefined): T {
        if (!this.port) { throw new Error("Port does not exist"); }
        return this.passThough.pipe(destination, options);
    }
}