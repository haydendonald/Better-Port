/**
 * This is a basic wrapper around the node serial port library (https://github.com/serialport/node-serialport) that makes sure the port stays connected
 * By Hayden Donald 2023
 */

import { SerialPort, SerialPortOpenOptions } from 'serialport'
import { AutoDetectTypes, PortInfo } from '@serialport/bindings-cpp';
import { ErrorCallback } from '@serialport/stream';
import { EventEmitter } from 'stream';
import internal = require('stream');

export type BetterSerialPortOptions = SerialPortOpenOptions<AutoDetectTypes> & {
  keepOpen?: boolean, //Should we keep the port open
  closeOnNoData?: boolean, //Should we close the port if no data is received
  disconnectTimeoutMS?: number //How long should we wait before disconnecting on no data
}
export class BetterSerialPortEvent {
  /** 
  * Will emit an error if one occurs
  * @event
  */
  static error = "error"

  /** 
  * Will emit when the port closes
  * @event
  */
  static close = "close"

  /** 
  * Will emit when the port opens
  * @event
  */
  static open = "open"

  /** 
  * Will emit when there is data from the port
  * @event
  */
  static data = "data"
}

export class BetterSerialPort extends internal.Writable {
  port: SerialPort | undefined;
  keepOpen: boolean;
  closeOnNoData: boolean;
  disconnectTimeoutMS: number;
  serialPortOptions: SerialPortOpenOptions<AutoDetectTypes>;
  path: string | undefined;
  disconnectedChecker: NodeJS.Timeout | undefined = undefined;
  pipes: { destination: NodeJS.WritableStream, options?: { end?: boolean; }, returnPipe: any }[] = [];
  constructor(options: BetterSerialPortOptions, openCallback?: ErrorCallback) {
    super();
    this.serialPortOptions = options;
    this.serialPortOptions.autoOpen = false;

    this.keepOpen = options.keepOpen == undefined ? true : options.keepOpen;
    this.closeOnNoData = options.closeOnNoData == undefined ? true : options.closeOnNoData;
    this.disconnectTimeoutMS = options.disconnectTimeoutMS != undefined ? options.disconnectTimeoutMS : 5000;
    if (typeof options.path == "string") {
      this.path = options.path;
    }

    //Auto open the port if set
    if (options.autoOpen == true) {
      if (openCallback) {
        this.openPort().then(() => { openCallback(null) }).catch(openCallback);
      }
      else {
        try { this.openPort(); }
        catch (e) { this.emit(BetterSerialPortEvent.error, e); }
      }
    }
  }

  /**
 * Does the port currently exist
 * @returns A promise<boolean>
 */
  portExists(): Promise<boolean> {
    return new Promise(async (resolve, reject) => {
      if (!this.path) {
        resolve(false);
        return;
      }

      try {
        var found = false;
        var ports: PortInfo[] = await SerialPort.list();
        for (var i in ports) {
          if (ports[i].path == this.path || ports[i].pnpId == this.path.split("/").pop()) {
            found = true;
            break;
          }
        }
        resolve(found);
      }
      catch (e) { reject(e); }
    });
  }

  /**
   * Is the port currently open
   */
  portOpen(): boolean {
    return this.port != undefined && this.port.isOpen;
  }

  /**
 * Open the port
 * @param keepOpen Keep the port open after opening
 * @returns A promise
 */
  openPort(keepOpen: boolean | undefined = undefined): Promise<void> {
    var self = this;
    if (keepOpen != undefined) { this.keepOpen = keepOpen; }
    return new Promise(async (resolve, reject) => {
      //Check if the port actually exists first and try to open it

      if (this.portOpen() == false && (await this.portExists()) == true) {

        //Recreate the port
        await this.closePort();
        this.port = new SerialPort(this.serialPortOptions);

        //Setup our handlers for disconnection
        var disconnectedHandler = async () => {
          await this.closePort();
        }

        this.port.once("close", async () => {
          this.emit(BetterSerialPortEvent.close);
          await disconnectedHandler();

          //Attempt to reopen the port if we are keeping it open
          await new Promise((resolve) => { setTimeout(resolve, 1000); });
          var tryIt = async () => {
            if (self.keepOpen) {
              try {
                await self.openPort();
              }
              catch (e) {
                await this.closePort();
                await new Promise((resolve) => { setTimeout(resolve, 1000); });
                await tryIt();
              }
            }
          };
          await tryIt();
        });

        this.port.once("open", () => {
          this.emit(BetterSerialPortEvent.open);
          this.updatePipes();
        });

        this.port.on("error", async (err) => {
          this.emit(BetterSerialPortEvent.error, err);
          await disconnectedHandler();
        });

        this.port.on("data", (data: any) => {
          this.emit(BetterSerialPortEvent.data, data);
          if (self.closeOnNoData == true) {
            clearTimeout(self.disconnectedChecker);
            self.disconnectedChecker = setTimeout(async () => { await disconnectedHandler(); }, self.disconnectTimeoutMS);
          }
        });

        await this.port.open();
        resolve();
      }
      else {
        reject(this.port == undefined ? "Port does not exist" : (this.port.isOpen ? "Port is already open" : "Port exists but is not open"));
      }
    });
  }


  /**
   * Close the port
   * @param keepClosed Keep the port closed after closing
   * @param disconnectError The error to pass to the disconnect event
   * @returns A promise
   */
  closePort(keepClosed: boolean = false, disconnectError?: Error): Promise<void> {
    return new Promise((resolve, reject) => {
      if (keepClosed == true) {
        this.keepOpen = false;
      }

      //Destroy the old port if it exists
      if (this.port) {
        if (this.port.isOpen) {
          this.port.close((err) => {
            if (err) { reject(err); return; }
            this.port?.removeAllListeners();
            this.port?.destroy();
            this.port = undefined;
            resolve();
          }, disconnectError);
        }
        else {
          resolve();
        }
      }
      else {
        resolve();
      }
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  write(chunk: any, encoding?: BufferEncoding, cb?: (error: Error | null | undefined) => void): boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  write(chunk: any, cb?: (error: Error | null | undefined) => void): boolean
  write(data: any, encoding?: any, callback?: any): boolean {
    if (!callback) { callback = (err: any) => { this.emit(BetterSerialPortEvent.error, err); } }
    if (!this.port) { callback("Port does not exist"); throw "Port does not exist"; }
    if (this.port.isOpen == false) { callback("Port is not open"); throw "Port is not open"; }
    if (this.port.writable == false) { callback("Port is not writable"); throw "Port is not writable"; }
    this.port.write(data, encoding, async (err) => {
      if (err) {
        callback(err);
      }
      else {
        callback(true);
      }
    });
    return true;
  }

  flush(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        if (!this.port) { throw "Port does not exist"; }
        this.port.flush((err) => {
          if (err) { reject(err); return; }
          resolve();
        });
      }
      catch (e) {
        reject(e);
      }
    });
  }

  updatePipes() {
    this.pipes.forEach(pipe => {
      pipe.returnPipe = this.port?.pipe(pipe.destination, pipe.options);
    });
  }

  pipe<T extends NodeJS.WritableStream>(destination: T, options?: { end?: boolean; }): T {
    if (!this.port) { throw "Port does not exist"; }
    this.pipes.push({ destination, options, returnPipe: this.port.pipe(destination, options) });
    return this.pipes[this.pipes.length - 1].returnPipe;
  }

  get baudRate(): number {
    if (!this.port) { throw "Port does not exist"; }
    return this.port.baudRate;
  }
}