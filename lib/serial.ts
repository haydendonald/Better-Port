import { BetterPortOptions, BetterPortI } from './index';
import { SerialPort, SerialPortOpenOptions } from 'serialport'
import { AutoDetectTypes, PortInfo } from '@serialport/bindings-cpp';

export type BetterSerialPortOptions = BetterPortOptions & SerialPortOpenOptions<AutoDetectTypes>;

export class Serial implements BetterPortI {
    portType: string = "Serial";
    port: SerialPort | undefined;
    path: string | undefined;
    serialPortOptions: SerialPortOpenOptions<AutoDetectTypes>;
    get isOpen(): boolean {
        return this.port != undefined && this.port.isOpen;
    }
    get writable(): boolean {
        return this.port !== undefined && this.port.writable;
    }
    get baudRate(): number {
        if (this.port == undefined) return 0;
        return this.port.baudRate;
    }
    constructor(options: BetterSerialPortOptions) {
        this.serialPortOptions = options;
        this.serialPortOptions.autoOpen = false;
        this.path = options.path;
        this.serialPortOptions = options;
    }

    portExists(): Promise<boolean> {
        var self = this;
        return new Promise(async (resolve, reject) => {
            try {
                if (self.path == undefined) { reject("Path is not set"); return; }
                var found = false;
                var ports: PortInfo[] = await SerialPort.list();
                for (var i in ports) {
                    if (ports[i].path == self.path || ports[i].pnpId == self.path.split("/").pop()) {
                        found = true;
                        break;
                    }
                }
                resolve(found);
            }
            catch (e) { reject(e); }
        });
    }
    portOpen(): boolean {
        return this.port != undefined && this.port.isOpen;
    }
    openPort(openCb: () => void, closeCb: () => void, errorCb: (err: any) => void, dataCb: (data: any) => void): Promise<void> {
        var self = this;
        return new Promise(async (resolve, reject) => {
            self.port = new SerialPort(self.serialPortOptions);
            self.port.once("close", async () => { await closeCb(); });
            self.port.once("open", async () => { await openCb(); });
            self.port.on("error", async (err) => { await errorCb(err); });
            self.port.on("data", async (data: any) => { await dataCb(data); });

            await self.port.open((err) => {
                if (err) { reject(err); return; }
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
                self.port?.removeAllListeners();
                self.port?.destroy();
                self.port = undefined;
                await new Promise((resolve) => { setTimeout(resolve, 1000); }); // Wait a second before resolving to make sure the port is actually closed
                resolve();
            }

            if (self.port.isOpen == false) { await destroy(); return; }
            else {
                self.port.close(async (err) => { await destroy(); }, disconnectError);
            }
        });
    }
    write(data: any, encoding?: any, callback?: any): boolean {
        if (!this.port) { callback("Port does not exist"); return false; }
        if (this.port.isOpen == false) { callback("Port is not open"); return false; }
        if (this.port.writable == false) { callback("Port is not writable"); return false; }
        return this.port.write(data, encoding, async (error) => {
            if (callback) { callback(error == null ? undefined : error); }
        });
    }
    flush(): Promise<void> {
        var self = this;
        return new Promise((resolve, reject) => {
            if (!self.port) { reject("Port does not exist"); return; }
            try {
                self.port.flush((err) => {
                    if (err) { reject(err); return; }
                    resolve();
                });
            }
            catch (e) {
                reject(e);
            }
        })
    }
    pipe<T extends NodeJS.WritableStream>(destination: T, options?: { end?: boolean | undefined; } | undefined): T {
        if (!this.port) { throw new Error("Port does not exist"); }
        return this.port.pipe(destination, options);
    }
}