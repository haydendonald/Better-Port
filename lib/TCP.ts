import { PassThrough } from 'stream';
import { BaseBetterPortOptions, BetterPortI, BetterPortType } from './index';
import * as net from 'net';

export type BetterTCPPortOptions = BaseBetterPortOptions & net.TcpSocketConnectOpts & {};

export class TCP implements BetterPortI {
    portType: string = BetterPortType.TCP;
    port?: net.Socket;
    options: BetterTCPPortOptions;
    socketOptions?: net.SocketConstructorOpts;
    passThough: PassThrough;
    connectionTimeout?: NodeJS.Timeout;

    get isOpen(): boolean { return this.port?.closed === false; }
    get path(): string | undefined { return `${this.options.host}:${this.options.port}`; }
    get writable(): boolean { return this.isOpen && this.port?.writable === true; }
    get baudRate(): number { return 0; }
    get remotePort(): number { return this.port?.remotePort || 0; }
    get remoteAddress(): string { return this.port?.remoteAddress || ""; }
    get localPort(): number { return this.port?.localPort || 0; }
    get localAddress(): string { return this.port?.localAddress || ""; }

    constructor(options: BetterTCPPortOptions, socketOptions?: net.SocketConstructorOpts) {
        this.options = options;
        this.socketOptions = socketOptions;
        this.passThough = new PassThrough();
        if (this.options.keepOpen != undefined) { this.options.keepAlive = this.options.keepOpen; }
    }

    portExists(): Promise<boolean> {
        //In the future maybe we can do a ping to the ip, for now just say it does exist
        return Promise.resolve(true);
    }
    portOpen(): boolean {
        return this.isOpen;
    }
    openPort(openCb: () => void, closeCb: () => void, errorCb: (err: any) => void, dataCb: (data: any) => void): Promise<void> {
        var self = this;
        return new Promise(async (resolve, reject) => {
            try {
                if (self.port) { await self.closePort(); }
                self.port = new net.Socket(self.socketOptions);
                self.port?.on("ready", () => {
                    clearTimeout(self.connectionTimeout);
                    openCb();
                });
                self.port?.on("close", () => { closeCb(); });
                self.port?.on("error", (err) => { errorCb(err); });
                self.port?.on("data", (data) => {
                    self.passThough.write(data);
                    dataCb(data);
                });

                //Attempt connection
                self.connectionTimeout = setTimeout(() => {
                    self.closePort();
                    errorCb("connection timeout");
                }, 5000);
                self.port?.connect(self.options);
            }
            catch (e) { reject(e); return; }
            resolve();
        });
    }
    closePort(): Promise<void> {
        var self = this;
        return new Promise(async (resolve) => {
            clearTimeout(self.connectionTimeout);

            //Destroy the old port if it exists
            if (!self.port) { resolve(); return; }

            let destroy = () => {
                self.port?.destroy();
                self.port = undefined;
                resolve();
            }

            //Setup a timeout if end takes too long
            self.connectionTimeout = setTimeout(() => {
                destroy();
            }, 5000);

            //Request the port to close and then destroy it
            self.port.end(() => {
                clearTimeout(self.connectionTimeout);
                destroy();
            });
        });
    }
    write(data: any, encoding?: any, callback?: any): boolean {
        if (!this.port) { if (callback) { callback("Port does not exist"); } return false; }
        if (this.isOpen == false) { if (callback) { callback("Not open"); } return false; }
        if (this.writable == false) { if (callback) { callback("Not writable"); } return false; }

        this.port.write(data, callback);
        return true;
    }
    flush(): Promise<void> {
        return Promise.resolve();
    }
    pipe<T extends NodeJS.WritableStream>(destination: T, options?: { end?: boolean | undefined; } | undefined): T {
        if (!this.port) { throw new Error("Port does not exist"); }
        return this.passThough.pipe(destination, options);
    }
}