/**
 * This is a project to wrap around ports such as serial/udp to provide a constant connection and some helpers
 * By Hayden Donald 2023
 */

import { ErrorCallback } from '@serialport/stream';
import internal = require('stream');
import * as Serial from './serial';
import * as UDP from './UDP';

export enum BetterPortType {
  Serial = "Serial",
  UDP = "UDP"
}

export interface BetterPortI {
  portType: string;
  isOpen: boolean;
  writable: boolean;
  path: string | undefined;
  portExists(): Promise<boolean>;
  portOpen(): boolean;
  openPort(openCb: () => void, closeCb: () => void, errorCb: (err: any) => void, dataCb: (data: any) => void): Promise<void>;
  closePort(disconnectError?: Error): Promise<void>;
  write(data: any, encoding?: any, callback?: any): boolean;
  flush(): Promise<void>;
  pipe<T extends NodeJS.WritableStream>(destination: T, options?: { end?: boolean; }): T;
}

export interface BaseBetterPortOptions {
  autoOpen?: boolean; //Should the port be opened automatically on creation
  keepOpen?: boolean; //Should we keep the port open
  closeOnNoData?: boolean; //Should we close the port if no data is received
  disconnectTimeoutMS?: number | undefined; //How long should we wait before disconnecting on no data
  sendWhenOpened?: Buffer | undefined; //Data to send when the port opened
  reconnectTimeoutMS?: number | undefined; //How long should we wait before reconnecting. Default 1000md
  connectionAttemptTimeoutMS?: number | undefined; //How long should we wait between failed connection attempts. Default 5000ms
}


export class BetterPortEvent {
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


class BaseBetterPort<T extends BetterPortI> extends internal.Writable {
  port: T;
  keepOpen: boolean;
  closeOnNoData: boolean;
  disconnectTimeoutMS: number;
  reconnectTimeoutMS: number;
  connectionAttemptTimeoutMS: number;
  disconnectedChecker: NodeJS.Timeout | undefined = undefined;
  pipes: { destination: NodeJS.WritableStream, options?: { end?: boolean; }, returnPipe: any }[] = [];
  sendWhenOpened: Buffer | undefined;

  get path(): string | undefined {
    if (!this.port) { return undefined; }
    return this.port.path;
  }

  get type(): string {
    return this.port.portType;
  }

  constructor(options: BetterPortOptions, port: T, openCallback?: any) {
    super();
    var autoOpen = options.autoOpen == undefined ? true : options.autoOpen;
    this.keepOpen = options.keepOpen == undefined ? true : options.keepOpen;
    this.closeOnNoData = options.closeOnNoData == undefined ? true : options.closeOnNoData;
    this.disconnectTimeoutMS = options.disconnectTimeoutMS != undefined ? options.disconnectTimeoutMS : 5000;
    this.reconnectTimeoutMS = options.reconnectTimeoutMS != undefined ? options.reconnectTimeoutMS : 1000;
    this.connectionAttemptTimeoutMS = options.connectionAttemptTimeoutMS != undefined ? options.connectionAttemptTimeoutMS : 5000;
    this.sendWhenOpened = options.sendWhenOpened;
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
          catch (e) { this.emit(BetterPortEvent.error, e); }
        }
      }, 0);
    }

    process.once("exit", this.closePort);
    process.once("SIGINT", this.closePort);
  }

  /**
 * Does the port currently exist
 * @returns A promise<boolean>
 */
  portExists(): Promise<boolean> {
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
      if (self.portOpen()) { resolve(); return; }
      if (await self.portExists() == false) { reject("Port does not exist"); return; }

      //Check if the port actually exists first and try to open it
      var openCb = () => {
        self.emit(BetterPortEvent.open);
        self.updatePipes();
        if (self.sendWhenOpened) {
          self.write(self.sendWhenOpened);
        }
      }

      var closeCb = async () => {
        self.emit(BetterPortEvent.close);
        await self.closePort();

        //Attempt to reopen the port if we are keeping it open
        await new Promise((resolve) => { setTimeout(resolve, this.reconnectTimeoutMS); });
        var tryIt = async () => {
          if (self.keepOpen) {
            try {
              await self.openPort();
            }
            catch (e) {
              await self.closePort();
              await new Promise((resolve) => { setTimeout(resolve, this.connectionAttemptTimeoutMS); });
              await tryIt();
            }
          }
        };
        await tryIt();
      }

      var errorCb = async (err: any) => {
        self.emit(BetterPortEvent.error, err);
        if (self.port.isOpen) {
          await self.closePort();
        }
        else {
          await closeCb();
        }
      }

      var dataCb = (data: any) => {
        self.emit(BetterPortEvent.data, data);
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
    process.removeListener("exit", this.closePort);
    process.removeListener("SIGINT", this.closePort);
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
    if (!callback) { callback = (err: any) => { if (err) { this.emit(BetterPortEvent.error, err); } } }
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

export type BetterSerialPortOptions = Serial.BetterSerialPortOptions;
export class BetterSerialPort extends BaseBetterPort<Serial.Serial> {
  constructor(options: BetterSerialPortOptions, openCallback?: ErrorCallback) {
    super(options, new Serial.Serial(options), openCallback);
  }
}


export type BetterUDPPortOptions = UDP.BetterUDPPortOptions;
export class BetterUDPPort extends BaseBetterPort<UDP.UDP> {
  constructor(options: BetterUDPPortOptions, openCallback?: any) {
    super(options, new UDP.UDP(options), openCallback);
  }
}