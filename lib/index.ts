/**
 * This is a basic wrapper around the node serial port library (https://github.com/serialport/node-serialport) that makes sure the port stays connected
 * By Hayden Donald 2023
 */

import { SerialPort, SerialPortOpenOptions } from 'serialport'
import { AutoDetectTypes, PortInfo } from '@serialport/bindings-cpp';
import { ErrorCallback } from '@serialport/stream';
export type BetterSerialPortOptions = SerialPortOpenOptions<AutoDetectTypes> & {
  keepOpen?: boolean,
  disconnectTimeoutMS?: number | boolean
}
export class BetterSerialPort extends SerialPort {
  keepOpen: boolean = false;
  disconnectedChecker: NodeJS.Timeout | undefined = undefined;
  disconnectTimeoutMS: number | boolean = 5000;
  constructor(options: BetterSerialPortOptions, openCallback?: ErrorCallback) {
    var autoOpen = options.autoOpen;
    options.autoOpen = false;
    super(options);
    this.keepOpen = options.keepOpen ? options.keepOpen : true;
    this.disconnectTimeoutMS = options.disconnectTimeoutMS != undefined ? options.disconnectTimeoutMS : 5000;

    //Auto open the port if set
    if (autoOpen == true) {
      if (openCallback) {
        this.openPort().then(() => { openCallback(null) }).catch(openCallback);
      }
      else {
        try { this.openPort(); }
        catch (e) { this.emit("error", e); }
      }
    }
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  write(chunk: any, encoding?: BufferEncoding, cb?: (error: Error | null | undefined) => void): boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  write(chunk: any, cb?: (error: Error | null | undefined) => void): boolean
  write(data: any, encoding?: any, callback?: any): boolean {
    new Promise(async (resolve) => {
      if (this.isOpen) {
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
   * Open the port
   * @param keepOpen Keep the port open after opening
   * @returns A promise
   */
  openPort(keepOpen: boolean | undefined = undefined): Promise<void> {
    var self = this;
    if (keepOpen != undefined) { this.keepOpen = keepOpen; }
    return new Promise(async (resolve, reject) => {
      //Check if the port actually exists first and try to open it
      if (!this.isOpen && (await this.portExists()) == true) {

        //Setup our handlers for disconnection
        var disconnectedHandler = () => {
          this.closePort();
        }

        super.on("close", async () => {
          disconnectedHandler();

          //Attempt to reopen the port if we are keeping it open
          var tryIt = async () => {
            if (self.keepOpen) {
              try {
                await self.open();
              }
              catch (e) {
                await new Promise((resolve) => { setTimeout(resolve, 1000); });
                await tryIt();
              }
            }
          };
          await tryIt();
        });

        super.on("error", (err) => {
          disconnectedHandler();
        });

        super.on("data", () => {
          if (self.disconnectTimeoutMS != false && typeof self.disconnectTimeoutMS == "number") {
            clearTimeout(self.disconnectedChecker);
            self.disconnectedChecker = setTimeout(disconnectedHandler, self.disconnectTimeoutMS);
          }
        });

        await self.open();
      }
      else {
        reject(this.isOpen == false ? "Port does not exist" : "Port is already open");
      }
    });
  }

  /**
   * Replace the open method with a promise
   * @returns A promise
   */
  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      super.open((err) => {
        if (err) { reject(err); return; }
        resolve();
      });
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
      if (!this.keepOpen || keepClosed == true) {
        this.keepOpen = false;
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