/**
 * This is a basic wrapper around the node serial port library (https://github.com/serialport/node-serialport) that makes sure the port stays connected
 * By Hayden Donald 2023
 */

import { SerialPort, SerialPortMock, SerialPortOpenOptions } from 'serialport'
import { AutoDetectTypes, PortInfo } from '@serialport/bindings-cpp';
import { ErrorCallback } from '@serialport/stream';
import { Writable, PassThrough, EventEmitter } from 'stream';
import internal = require('stream');
import * as dgram from 'dgram'
import { runInThisContext } from 'vm';

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

export class BetterSerialPortError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BetterSerialPortError";
  }

  /**
   * Auto cast to string
   * @returns The error message
   */
  toString(): string {
    return this.message;
  }
}

export class BetterSerialPort extends internal.Writable {
  port: SerialPort | dgram.Socket | undefined;
  netPort: number | undefined;
  netAddress: string | undefined;
  netUDPBound: boolean = false;
  private udpInput: Writable;
  isudpServer: boolean = false;
  clients: dgram.RemoteInfo[] = [];
  type: "serial" | "udp" | undefined;
  keepOpen: boolean;
  closeOnNoData: boolean;
  disconnectTimeoutMS: number;
  serialPortOptions: SerialPortOpenOptions<AutoDetectTypes>;
  path: string | undefined;
  disconnectedChecker: NodeJS.Timeout | undefined = undefined;
  pipes: { destination: NodeJS.WritableStream, options?: { end?: boolean; }, returnPipe: any }[] = [];
  constructor(options: BetterSerialPortOptions, openCallback?: ErrorCallback) {
    super();
    var autoOpen = options.autoOpen == undefined ? true : options.autoOpen;
    this.serialPortOptions = options;
    this.serialPortOptions.autoOpen = false;
    this.keepOpen = options.keepOpen == undefined ? true : options.keepOpen;
    this.closeOnNoData = options.closeOnNoData == undefined ? true : options.closeOnNoData;
    this.disconnectTimeoutMS = options.disconnectTimeoutMS != undefined ? options.disconnectTimeoutMS : 5000;
    this.udpInput = new PassThrough();
    if (typeof options.path == "string") {
      this.path = options.path;
      // if starts with udp:<address>:<port>
      if (options.path.startsWith("udpin:") || options.path.startsWith("udp:")) {
        this.type = "udp";
        this.isudpServer = true;
        var parts = options.path.split(":");
        this.netAddress = parts[1];
        this.netPort = parseInt(parts[2]);
      } else if (options.path.startsWith("udpout:")) {
        this.type = "udp";
        this.isudpServer = false;
        var parts = options.path.split(":");
        this.netAddress = parts[1];
        this.netPort = parseInt(parts[2]);
      } else {
        this.type = "serial";
      }
    }

    //Auto open the port if set
    if (autoOpen == true) {
      if (openCallback) {
        this.openPort().then(() => { openCallback(null) }).catch(openCallback);
      }
      else {
        try { this.openPort(); }
        catch (e) { this.emit(BetterSerialPortEvent.error, e); }
      }
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
    return this.port != undefined && 
           ((this.port instanceof SerialPort && this.port.isOpen) ||
           (this.port instanceof dgram.Socket && this.netUDPBound));
  }

  /**
   * Open the serial port
   * @returns A promise
   */
  openSerialPort(): Promise<void> {
    var self = this;
    return new Promise(async (resolve, reject) => {
      //Check if the port actually exists first and try to open it

      if (this.portOpen() == false) {

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
      else if (this.port instanceof SerialPort) {
        reject(this.port == undefined ? new BetterSerialPortError("Port does not exist") : (this.port.isOpen ? new BetterSerialPortError("Port is already open") : new BetterSerialPortError("Port exists but is not open")));
      } else {
        reject(new BetterSerialPortError("Port is not a serial port"));
      }
    });
  }

  /**
   * Open the udp port
   * @returns A promise
   */
  openUDPPort(): Promise<void> {
    var self = this;
    return new Promise(async (resolve, reject) => {
      //Check if the port actually exists first and try to open it

      if (this.portOpen() == false && this.netPort !== undefined && this.netAddress !== undefined) {
        //Recreate the port
        await this.closePort();
        if (this.isudpServer) {
          this.port = dgram.createSocket({
            type: 'udp4',
            reuseAddr: true
          });
        } else {
          this.port = dgram.createSocket({
            type: 'udp4'
          });
        }

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

        this.port.once("listening", () => {
          this.emit(BetterSerialPortEvent.open);
          this.updatePipes();
        });
        this.port.once("connect", () => {
          this.emit(BetterSerialPortEvent.open);
          this.updatePipes();
        });

        this.port.on("error", async (err) => {
          this.emit(BetterSerialPortEvent.error, err);
          await disconnectedHandler();
        });

        this.port.on("message", (data: any, rinfo: dgram.RemoteInfo) => {
          // check if rinfo is in clients
          var found = false;
          for (var i in this.clients) {
            if (this.clients[i].address == rinfo.address && this.clients[i].port == rinfo.port) {
              found = true;
              break;
            }
          }
          if (!found) {
            this.clients.push(rinfo);
          }
          this.udpInput.write(data);
          this.emit(BetterSerialPortEvent.data, data);
          if (self.closeOnNoData == true) {
            clearTimeout(self.disconnectedChecker);
            self.disconnectedChecker = setTimeout(async () => { await disconnectedHandler(); }, self.disconnectTimeoutMS);
          }
        });
        if (this.isudpServer) {
          this.port.bind({
              address: this.netAddress,
              port: this.netPort},
              () => {
                  this.netUDPBound = true;
                  resolve();
              });
        } else {
          this.port.connect(
                    this.netPort,
                    this.netAddress,
                    () => {
                        this.netUDPBound = true;
                        resolve();
                    });
        }
      }
    });
  }

  /**
 * Open the port
 * @param keepOpen Keep the port open after opening
 * @returns A promise
 */
  openPort(keepOpen: boolean | undefined = undefined): Promise<void> {
    var self = this;
    if (keepOpen != undefined) { this.keepOpen = keepOpen; }
    if (this.type == "serial") {
      return this.openSerialPort();
    } else if (this.type == "udp") {
      return this.openUDPPort();
    } else {
      return new Promise(async (resolve, reject) => {
        reject(new BetterSerialPortError("Invalid port type"));
      });
    }
  }


  closeSerialPort(disconnectError?: Error) : Promise<void> {
    return new Promise((resolve, reject) => {
      //Destroy the old port if it exists
      if (this.port instanceof SerialPort) {
        if (this.port.isOpen) {
          this.port.close(async (err) => {
            if (err) { reject(err); return; }
            this.port?.removeAllListeners();
            if (this.port instanceof SerialPort) {
              this.port?.destroy();
            } else {
              reject(new BetterSerialPortError("Port is not a serial port"));
            }
            this.port = undefined;
            await new Promise((resolve) => { setTimeout(resolve, 1000); }); // Wait a second before resolving to make sure the port is actually closed
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

  closeUDPPort() : Promise<void> {
    return new Promise((resolve, reject) => {
      //Destroy the old port if it exists
      if (this.port instanceof dgram.Socket) {
        if (this.netUDPBound) {
          this.port.close(() => {
            this.port?.removeAllListeners();
            if (this.port instanceof dgram.Socket) {
              this.port.unref();
            } else {
              reject(new BetterSerialPortError("Port is not a udp port"));
            }
            this.port = undefined;
            resolve();
          });
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

  /**
   * Close the port
   * @param keepClosed Keep the port closed after closing
   * @param disconnectError The error to pass to the disconnect event
   * @returns A promise
   */
  closePort(keepClosed: boolean = false, disconnectError?: Error): Promise<void> {
    if (keepClosed == true) {
      this.keepOpen = false;
    }
    if (this.type == "serial") {
      return this.closeSerialPort(disconnectError);
    } else if (this.type == "udp") {
      return this.closeUDPPort();
    } else {
      return new Promise(async (resolve, reject) => {
        reject(new BetterSerialPortError("Invalid port type"));
      });
    }
  }

  // Serial write
  serialWrite(data: any, encoding?: any, callback?: any): boolean {
    if (!(this.port instanceof SerialPort)) {
      throw new BetterSerialPortError("Port is not a serial port");
    }
    if (!callback) { callback = (err: any) => { this.emit(BetterSerialPortEvent.error, err); } }
    if (!this.port) { callback(new BetterSerialPortError("Port does not exist")); throw new BetterSerialPortError("Port does not exist"); }
    if (this.portOpen() == false) { callback(new BetterSerialPortError("Port is not open")); throw new BetterSerialPortError("Port is not open"); }
    if (this.port.writable == false) { callback(new BetterSerialPortError("Port is not writable")); throw new BetterSerialPortError("Port is not writable");}
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

  // UDP write
  udpWrite(data: any, callback?: any): boolean {
    if (!(this.port instanceof dgram.Socket)) {
      throw new BetterSerialPortError("Port is not a udp port");
    }
    if (this.clients.length == 0) { callback(new BetterSerialPortError("No clients connected")); throw new BetterSerialPortError("No clients connected");}
    if (!callback) { callback = (err: any) => { this.emit(BetterSerialPortEvent.error, err); } }
    if (!this.port) { callback(new BetterSerialPortError("Port does not exist")); throw new BetterSerialPortError("Port does not exist"); }
    if (this.portOpen() == false) { callback(new BetterSerialPortError("Port is not open")); throw new BetterSerialPortError("Port is not open"); }
    // run through clients and send
    if (this.isudpServer) {
      for (var i in this.clients) {
        this.port.send(data, this.clients[i].port, this.clients[i].address, (err) => {
          if (err) {
            callback(err);
          }
          else {
            callback(true);
          }
        });
      }
    } else {
      // we are connected to a server, send to that server
      this.port.send(data, async (err) => {
        if (err) {
          callback(err);
        }
        else {
          callback(true);
        }
      });
    }
    return true;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  write(chunk: any, encoding?: BufferEncoding, cb?: (error: Error | null | undefined) => void): boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  write(chunk: any, cb?: (error: Error | null | undefined) => void): boolean
  write(
    data: string | Buffer | number[],
    encoding?: BufferEncoding | ((error: Error | null | undefined) => void),
    callback?: (error: Error | null | undefined) => void,
  ) {    if (this.type == "serial") {
      if (typeof encoding === 'function') {
        return this.serialWrite(data, encoding);
      } else {
        return this.serialWrite(data, encoding, callback);
      }
    } else if (this.type == "udp") {
      if (typeof encoding === 'function') {
        return this.udpWrite(data, callback);
      } else {
        throw new BetterSerialPortError("UDP write does not support encoding");
      }
    } else {
      throw new BetterSerialPortError("Invalid port type");
    }
  }

  flush(): Promise<void> {
    if (this.type == "serial" ) {
      return new Promise((resolve, reject) => {
        try {
          if (!this.port) { throw new BetterSerialPortError("Port does not exist"); }
          var serialport = this.port as SerialPort;
          serialport.flush((err) => {
            if (err) { reject(err); return; }
            resolve();
          });
        }
        catch (e) {
          reject(e);
        }
      });
    } else if (this.type == "udp") {
      return new Promise((resolve, reject) => {
        if (!this.port) { throw new BetterSerialPortError("Port does not exist"); }
        resolve();
      });
    } else {
      return new Promise((resolve, reject) => {
        reject(new BetterSerialPortError("Invalid port type"));
      });
    }
  }

  updatePipes() {
    this.pipes.forEach(pipe => {
      if (this.port instanceof SerialPort) {
        pipe.returnPipe = this.port?.pipe(pipe.destination, pipe.options);
      } else if (this.port instanceof dgram.Socket) {
        pipe.returnPipe = this.udpInput.pipe(pipe.destination, pipe.options);
      } else {
        pipe.returnPipe = undefined;
      }
    });
  }

  pipe<T extends NodeJS.WritableStream>(destination: T, options?: { end?: boolean; }): T {
    if (!this.port) { throw new BetterSerialPortError("Port does not exist"); }
    if (this.port instanceof SerialPort) {
      this.pipes.push({ destination, options, returnPipe: this.port.pipe(destination, options) });
    } else if (this.port instanceof dgram.Socket) {
      this.pipes.push({ destination, options, returnPipe: this.udpInput.pipe(destination, options) });
    } else {
      throw new BetterSerialPortError("Invalid port type");
    }
    return this.pipes[this.pipes.length - 1].returnPipe;
  }

  get baudRate(): number {
    if (!this.port) { throw new BetterSerialPortError("Port does not exist"); }
    if (this.port instanceof SerialPort) {
      return this.port.baudRate;
    } else {
      return this.baudRate;
    }
  }
}