# Better Port
This is a basic wrapper for ports that adds some extra functionality to provide a constant connection that i feel is lacking.

This project originally started as a wrapper called [Better-Serial-Port](https://www.npmjs.com/package/better-serial-port) for [Node Serial Port](https://github.com/serialport/node-serialport) to provide a constant connection but is now written to support
different protocols such as UDP, thus a rename to Better Port.

# Features
* The port is monitored. If it disconnects it will emit the `close` event and when it is detected again it will automatically reconnect and emit the `open` event
* Can auto reopen the port on error
* If there is no data for a specific period of time it will assume the port disconnected

# How to use
Currently this project supports the following ports:
## [Node Serial Port](https://github.com/serialport/node-serialport) ([docs](https://serialport.io/docs/))
```javascript
//Create the port
const BetterPort = require("./dist/index.js");
const BetterPortEvent = BetterPort.BetterPortEvent;
var port = new BetterPort.BetterSerialPort({
    path: "",
    baudRate: 912600,
    keepOpen: true,
    autoOpen: true
    //Any extra open options for serial port
});

//Setup our events
port.on(BetterPortEvent.open, () => {
    console.log("Port opened");
});
port.on(BetterPortEvent.close, () => {
    console.log("Port closed");
});
port.on(BetterPortEvent.error, (err) => {
    console.log("Port error: ", err);
});
port.on(BetterPortEvent.data, (data) => {
    console.log("Port data: " + data.toString());
});

//Open the port
port.openPort().then(() => {
    console.log("Port created!");
}).catch((err) => {
    console.log("Port open error: ", err);
});
```

## [UDP (dgram)](https://nodejs.org/api/dgram.html)
```javascript
const BetterPort = require("./dist/index.js");
const BetterPortEvent = BetterPort.BetterPortEvent;

//Open a UDP client on port 7000
var port = new BetterPort.BetterUDPPort({
    recPort: 7000,
    keepOpen: true,
    autoOpen: true
    //Any extra open options for dram
});

//Setup our events
port.on(BetterPortEvent.open, () => {
    console.log("Port opened");
});
port.on(BetterPortEvent.close, () => {
    console.log("Port closed");
});
port.on(BetterPortEvent.error, (err) => {
    console.log("Port error: ", err);
});
port.on(BetterPortEvent.data, (data) => {
    console.log("Port data: " + data.toString());
});

//Open the port
port.openPort().then(() => {
    console.log("Port created!");
}).catch((err) => {
    console.log("Port open error: ", err);
});
```

## [TCP (net)](https://nodejs.org/api/net.html)
```javascript
const BetterPort = require("./dist/index.js");
const BetterPortEvent = BetterPort.BetterPortEvent;

//Open a TCP client on port 7000
var port = new BetterPort.BetterTCPPort({
    host: "192.168.0.1",
    port: 5000,
    keepOpen: true,
    autoOpen: true
    //Any extra open options for net
});

//Setup our events
port.on(BetterPortEvent.open, () => {
    console.log("Port opened");
});
port.on(BetterPortEvent.close, () => {
    console.log("Port closed");
});
port.on(BetterPortEvent.error, (err) => {
    console.log("Port error: ", err);
});
port.on(BetterPortEvent.data, (data) => {
    console.log("Port data: " + data.toString());
});

//Open the port
port.openPort().then(() => {
    console.log("Port created!");
}).catch((err) => {
    console.log("Port open error: ", err);
});
```

This project does add some extra functionality to these as well:

### Extra methods
```typescript
portExists(): Promise<boolean> //Does the port exist
portOpen(): boolean //Is the port currently open
openPort(keepOpen?: boolean): Promise<void> //Will open the port
closePort(keepClosed: boolean = false, disconnectError?: Error): Promise<void> //Will close the port and attempt reopen if keepClosed is not set to true
portOpen(): boolean //If the port is currently open
```

### Extra Options
```typescript
  autoOpen?: boolean; //Should the port be opened automatically on creation
  keepOpen?: boolean; //Should we keep the port open
  closeOnNoData?: boolean; //Should we close the port if no data is received
  disconnectTimeoutMS?: number | undefined; //How long should we wait before disconnecting on no data
  sendWhenOpened?: Buffer | undefined; //Data to send when the port opened
  reconnectTimeoutMS?: number | undefined; //How long should we wait before reconnecting. Default 1000md
  connectionAttemptTimeoutMS?: number | undefined; //How long should we wait between failed connection attempts. Default 5000ms
```

## Overridden methods
The following methods cab be used normally but are replaced by this project
```typescript
write(chunk: any, encoding?: BufferEncoding, cb?: (error: Error | null | undefined) => void): boolean
write(chunk: any, cb?: (error: Error | null | undefined) => void): boolean
write(data: any, encoding?: any, callback?: any): boolean
flush()
pipe<T extends NodeJS.WritableStream>(destination: T, options?: { end?: boolean; }): T
```