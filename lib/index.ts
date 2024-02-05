/**
 * This is a basic wrapper around the node serial port library (https://github.com/serialport/node-serialport) that makes sure the port stays connected
 * By Hayden Donald 2023
 */

import { ErrorCallback } from '@serialport/stream';
import internal = require('stream');
import { Serial, BetterSerialPortOptions } from './serial';
import { UDP, BetterUDPPortOptions } from './UDP';

export interface BetterSerialPortI {
  path: string | undefined;
  isOpen: boolean;
  writable: boolean;
  portExists(): Promise<boolean>;
  portOpen(): boolean;
  openPort(openCb: () => void, closeCb: () => void, errorCb: (err: any) => void, dataCb: (data: any) => void): Promise<void>;
  closePort(disconnectError?: Error): Promise<void>;
  write(data: any, encoding?: any, callback?: any): boolean;
  flush(): Promise<void>;
  pipe<T extends NodeJS.WritableStream>(destination: T, options?: { end?: boolean; }): T;
}

export interface BetterPortOptions {
  path: string | undefined; //The path
  autoOpen?: boolean; //Should the port be opened automatically on creation
  keepOpen?: boolean; //Should we keep the port open
  closeOnNoData?: boolean; //Should we close the port if no data is received
  disconnectTimeoutMS?: number | undefined; //How long should we wait before disconnecting on no data
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


class BetterPort extends internal.Writable {
  port: BetterSerialPortI;
  keepOpen: boolean;
  closeOnNoData: boolean;
  disconnectTimeoutMS: number;
  disconnectedChecker: NodeJS.Timeout | undefined = undefined;
  pipes: { destination: NodeJS.WritableStream, options?: { end?: boolean; }, returnPipe: any }[] = [];
  get path(): string | undefined { return this.port.path; }

  constructor(options: BetterPortOptions, port: BetterSerialPortI, openCallback?: ErrorCallback) {
    super();
    var autoOpen = options.autoOpen == undefined ? true : options.autoOpen;
    this.keepOpen = options.keepOpen == undefined ? true : options.keepOpen;
    this.closeOnNoData = options.closeOnNoData == undefined ? true : options.closeOnNoData;
    this.disconnectTimeoutMS = options.disconnectTimeoutMS != undefined ? options.disconnectTimeoutMS : 5000;
    this.port = port;

    //Auto open the port if set
    if (autoOpen == true) {
      //Setup a timeout here so we can await the open, since we can't do this in a constructor
      setTimeout(async () => {
        if (openCallback) {
          this.openPort().then(() => { openCallback(null) }).catch(openCallback);
        }
        else {
          try { await this.openPort(); }
          catch (e) { this.emit(BetterSerialPortEvent.error, e); }
        }
      }, 0);
    }

    var exit = async () => {
      await this.closePort();
    }
    process.on("exit", async function () { await exit() });
    process.on("SIGINT", async function () { await exit(); });
  }

  /**
 * Does the port currently exist
 * @returns A promise<boolean>
 */
  portExists(): Promise<boolean> {
    if (!this.port.path) {
      return Promise.resolve(false);
    }
    return this.port.portExists();
  }

  /**
   * Is the port currently open
   */
  portOpen(): boolean {
    return this.port.portOpen();
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
      if (self.portOpen() == false && (await self.portExists()) == true) {
        var openCb = () => {
          self.emit(BetterSerialPortEvent.open);
          self.updatePipes();
        }

        var closeCb = async () => {
          self.emit(BetterSerialPortEvent.close);
          await self.closePort();

          //Attempt to reopen the port if we are keeping it open
          await new Promise((resolve) => { setTimeout(resolve, 1000); });
          var tryIt = async () => {
            if (self.keepOpen) {
              try {
                await self.openPort();
              }
              catch (e) {
                await self.closePort();
                await new Promise((resolve) => { setTimeout(resolve, 1000); });
                await tryIt();
              }
            }
          };
          await tryIt();
        }

        var errorCb = async (err: any) => {
          self.emit(BetterSerialPortEvent.error, err);
          if (self.port.isOpen) {
            await self.closePort();
          }
          else {
            await closeCb();
          }
        }

        var dataCb = (data: any) => {
          self.emit(BetterSerialPortEvent.data, data);
          if (self.closeOnNoData == true) {
            clearTimeout(self.disconnectedChecker);
            self.disconnectedChecker = setTimeout(async () => {
              await self.closePort();
            }, self.disconnectTimeoutMS);
          }
        }

        //Ok close and open it again
        try {
          await self.closePort();
          await self.port.openPort(openCb, closeCb, errorCb, dataCb);
          resolve();
        }
        catch (e) {
          reject(e);
        }
      }
      else {
        reject(self.port.isOpen ? "Port is already open" : `Port ${self.port.path} does not exist`);
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
    if (keepClosed == true) { this.keepOpen = false; }
    return this.port.closePort(disconnectError);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  write(chunk: any, encoding?: BufferEncoding, cb?: (error: Error | null | undefined) => void): boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  write(chunk: any, cb?: (error: Error | null | undefined) => void): boolean
  write(data: any, encoding?: any, callback?: any): boolean {
    if (typeof encoding == "function") {
      callback = encoding;
      encoding = undefined;
    }
    if (!callback) { callback = (err: any) => { if (err) { this.emit(BetterSerialPortEvent.error, err); } } }
    return this.port.write(data, encoding, callback);
  }

  flush(): Promise<void> {
    return this.port.flush();
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
}

export class BetterSerialPort extends BetterPort {
  constructor(options: BetterSerialPortOptions, openCallback?: ErrorCallback) {
    super(options, new Serial(options), openCallback);
  }
}

export class BetterUDPPort extends BetterPort {
  constructor(options: BetterUDPPortOptions, openCallback?: ErrorCallback) {
    super(options, new UDP(options), openCallback);
  }
}