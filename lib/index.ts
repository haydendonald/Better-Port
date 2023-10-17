/**
 * This is a basic wrapper around the node serial port library (https://github.com/serialport/node-serialport) that makes sure the port stays connected
 * By Hayden Donald 2023
 */

import { SerialPort, SerialPortOpenOptions } from 'serialport'
import { AutoDetectTypes, PortInfo } from '@serialport/bindings-cpp';
import { ErrorCallback } from '@serialport/stream';
export type BetterSerialPortOptions = SerialPortOpenOptions<AutoDetectTypes> & {
  keepOpen?: boolean,
  checkerIntervalMS?: number,
  closePortOnError?: boolean,
  assumeDisconnectMS?: number
}
export class BetterSerialPort extends SerialPort {
  checker: NodeJS.Timeout | undefined = undefined;
  disconnectionChecker: NodeJS.Timeout | undefined = undefined;
  keepOpen: boolean = true;
  checkerIntervalMS: number = 1000;
  pnpId: string | undefined = undefined;
  assumeDisconnectMS: number | undefined = undefined;
  constructor(options: BetterSerialPortOptions, openCallback?: ErrorCallback) {
    var autoOpen = options.autoOpen == false ? false : true;
    options.autoOpen = false;
    super(options);

    if (options.path.toLowerCase().includes("serial/by-id")) {
      this.pnpId = options.path.split("/").pop()!;
    }

    this.on("close", () => {
      clearTimeout(this.disconnectionChecker);
    });

    this.on("error", () => {
      if (options.closePortOnError == true) {
        this.closePort();
      }
    });

    if (options.keepOpen !== undefined) { this.keepOpen = options.keepOpen; }
    if (options.checkerIntervalMS !== undefined) { this.checkerIntervalMS = options.checkerIntervalMS; }
    if (options.assumeDisconnectMS !== undefined) { this.assumeDisconnectMS = options.assumeDisconnectMS; }
    if (autoOpen) {
      if (openCallback) {
        this.openPort().then(() => { openCallback(null) }).catch(openCallback);
      }
      else {
        try { this.openPort(); }
        catch (e) { }
      }
    }
  }

  /**
   * Stop the checker from running
   */
  stopChecker() {
    clearInterval(this.checker);
    clearTimeout(this.disconnectionChecker);
  }

  /**
   * Does the port currently exist
   * @returns A promise<boolean>
   */
  portExists(): Promise<boolean> {
    return new Promise(async (resolve, reject) => {
      try {
        var found = false;
        var ports: PortInfo[] = await SerialPort.list();
        for (var i in ports) {
          if (ports[i].path == this.path || ports[i].pnpId == this.pnpId) {
            found = true;
            break;
          }
        }
        resolve(found);
      }
      catch (e) { reject(e); }
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  write(chunk: any, encoding?: BufferEncoding, cb?: (error: Error | null | undefined) => void): boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  write(chunk: any, cb?: (error: Error | null | undefined) => void): boolean
  write(data: any, encoding?: any, callback?: any): boolean {
    new Promise(async (resolve) => {
      if (await this.isConnected()) {
        resolve(super.write(data, encoding, callback));
      }
      else {
        if (callback) { callback("Port is not connected"); }
        resolve(false);
      }
    });
    return true;
  }

  /**
   * Is the port currently connected
   * @returns A promise<boolean> if the port is available and open
   */
  isConnected(): Promise<boolean> {
    return new Promise(async (resolve, reject) => {
      try {
        resolve(await this.portExists() && this.isOpen);
      }
      catch (e) { reject(e); }
    });
  }

  /**
   * Start the checker
   */
  startChecker() {
    if (this.keepOpen) {
      clearInterval(this.checker);
      clearTimeout(this.disconnectionChecker);
      this.checker = setInterval(async () => {
        try {
          if ((await this.portExists()) && !this.isOpen && this.keepOpen) {
            await this.openPort();
          }
          else if (!(await this.isConnected()) && this.isOpen) {
            await this.closePort();
          }
        }
        catch (e) { }
      }, this.checkerIntervalMS);

      if (this.assumeDisconnectMS) {
        this.on("data", () => {
          clearTimeout(this.disconnectionChecker);
          if (this.isOpen) {
            this.disconnectionChecker = setTimeout(async () => {
              if (this.isOpen) { this.close(); }
            }, this.assumeDisconnectMS);
          }
        });
      }
    }
    else {
      this.stopChecker();
    }
  }

  /**
   * Open the port
   * @returns A promise
   */
  openPort(): Promise<void> {
    return new Promise(async (resolve, reject) => {
      //Check if the port actually exists first and try to open it
      if ((await this.portExists() && !this.isOpen)) {
        super.open((err) => {
          if (err) { reject(err); return; }
          resolve();
        });
      }
      else {
        reject("Port does not exist");
      }

      if (!this.checker) {
        this.startChecker();
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
      clearTimeout(this.disconnectionChecker);
      if (!this.keepOpen || keepClosed == true) {
        this.stopChecker();
      }
      if (this.isOpen) {
        super.close((err) => {
          if (err) { reject(err); return; }
          resolve();
        }, disconnectError);
      }
      else {
        resolve();
      }
    });
  }
}