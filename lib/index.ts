/**
 * This is a basic wrapper around the node serial port library (https://github.com/serialport/node-serialport) that makes sure the port stays connected
 * By Hayden Donald 2023
 */

import { SerialPort, SerialPortOpenOptions } from 'serialport'
import { AutoDetectTypes, PortInfo } from '@serialport/bindings-cpp';
import { ErrorCallback } from '@serialport/stream';
export type BetterSerialPortOptions = SerialPortOpenOptions<AutoDetectTypes> & {
  keepOpen?: boolean,
  checkerIntervalMS?: number
}
export class BetterSerialPort extends SerialPort {
  checker: NodeJS.Timeout | undefined = undefined;
  keepOpen: boolean = true;
  checkerIntervalMS: number = 1000;
  connected: boolean = false;
  pnpId: string | undefined = undefined;
  constructor(options: BetterSerialPortOptions, openCallback?: ErrorCallback) {
    var autoOpen = options.autoOpen == false ? false : true;
    options.autoOpen = false;
    super(options);
    if (options.path.toLowerCase().includes("serial/by-id")) {
      this.pnpId = options.path.split("/").pop()!;
    }

    this.on("open", () => {
      this.connected = true;
    });

    this.on("close", () => {
      this.connected = false;
    });

    if (options.keepOpen !== undefined) { this.keepOpen = options.keepOpen; }
    if (options.checkerIntervalMS !== undefined) { this.checkerIntervalMS = options.checkerIntervalMS; }
    if (autoOpen && openCallback) {
      this.openPort().then(() => { openCallback(null) }).catch(openCallback);
    }
  }

  /**
   * Stop the checker from running
   */
  stopChecker() {
    clearInterval(this.checker);
  }

  /**
   * Is the port currently connected
   * @returns If the port is connected
   */
  isConnected() {
    return this.connected;
  }

  /**
   * Start the checker
   */
  startChecker() {
    if (this.keepOpen) {
      clearInterval(this.checker);
      this.checker = setInterval(async () => {
        //Check if our port exists and handle depending on this
        var found = false;
        var ports: PortInfo[] = await SerialPort.list();
        for (var i in ports) {
          if (ports[i].path == this.path || ports[i].pnpId == this.pnpId) {
            found = true;
            break;
          }
        }

        if (found && !this.connected && this.keepOpen) {
          await this.openPort();
        }
        else if (!found && this.connected) {
          await this.closePort();
        }
      }, this.checkerIntervalMS);
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
    return new Promise((resolve, reject) => {
      super.open((err) => {
        if (err) { reject(err); return; }
        resolve();
      });
      this.startChecker();
    });
  }

  /**
   * Close the port
   * @returns A promise
   */
  closePort(disconnectError?: Error): Promise<void> {
    return new Promise((resolve, reject) => {
      this.connected = false;
      if (!this.keepOpen) {
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