# Better Serial Port
This is a basic wrapper around [Node Serial Port](https://github.com/serialport/node-serialport) that adds some extra functionality that i feel it is lacking.

# Features
* The port is monitored. If it disconnects it will emit the `close` event and when it is detected again it will automatically reconnect and emit the `open` event

# How to use
This is just an extension of [Node Serial Port](https://github.com/serialport/node-serialport) so check out the [docs](https://serialport.io/docs/) for that project. 

However, this project does add some extra functionality:




# Example

