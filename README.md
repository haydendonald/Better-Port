# Better Serial Port
This is a basic wrapper around [Node Serial Port](https://github.com/serialport/node-serialport) that adds some extra functionality that i feel it is lacking.

# Features
* The port is monitored. If it disconnects it will emit the `close` event and when it is detected again it will automatically reconnect and emit the `open` event
* Can auto reopen the port on error
* If there is no data for a specific period of time it will assume the port disconnected

# How to use
This is just an extension of [Node Serial Port](https://github.com/serialport/node-serialport) so check out the [docs](https://serialport.io/docs/) for that project. 

However, this project does add some extra functionality:

### Extra methods
* `openPort(keepOpen?: boolean): Promise<void>`: Will open the port
* `closePort(keepClosed: boolean = false, disconnectError?: Error): Promise<void>`: Will close the port and attempt reopen if keepClosed is not set to true
* `portOpen(): boolean`: If the port is currently open

### Extra Options
* `BetterSerialPortOptions.keepOpen: boolean`: Should the port be kept open?
* `BetterSerialPortOptions.closeOnNoData: number | boolean`: Should we close (and reopen) the port if we don't get any data
* `BetterSerialPortOptions.disconnectTimeoutMS: number | boolean`: How long of no data before assuming disconnection

## Overriden methods
* `write()`: Will re-open the port if not successful

# Example
```javascript
const BetterSerialPort = require("better-serial-port");

//Create the port and keep it open
const serialport = new BetterSerialPort.BetterSerialPort({
    path: "/dev/example",
    baudRate: 9600,
    keepOpen: true,
    closeOnNoData: true,
    disconnectTimeoutMS: 1000
});

//Write example
serialport.write("Hello World!");

//Print out any data
serialport.on("data", (data) => {
    console.log(data);
});

//When the port is connected
serialport.on("open", () => {
    console.log("Port connected!");
});

//When the port is disconnected
serialport.on("close", () => {
    console.log("Port disconnected");
});

//Close the port
function close() {
    serialport.closePort();
}

//Close the port and don't re-open it
function stayClosed() {
    serialport.closePort(true);
}


```
