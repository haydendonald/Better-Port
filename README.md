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
* `openPort(): Promise<void>`: Will open the port and start the checker if required
* `closePort(): Promise<void>`: Will close the port and stop the checker

### Extra Options
* `BetterSerialPortOptions.keepOpen: boolean`: Should the port be kept open?
* `BetterSerialPortOptions.disconnectTimeoutMS: number | boolean`: How often should we check the port? Set this to `false` to disable the checker

# Example
```javascript
const BetterSerialPort = require("better-serial-port");

//Create the port and keep it open
const serialport = new BetterSerialPort.BetterSerialPort({
    path: "/dev/example",
    baudRate: 9600,
    keepOpen: true,
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
```
