const BetterPort = require("./dist/index.js");
const BetterPortEvent = BetterPort.BetterPortEvent;
const NodeMavlink = require('node-mavlink');

var mode = "udp"; //serial or udp

async function main() {
    var firstOpen = true;

    if (mode == "serial") {
        //Listen to an autopilot over serial
        var port = new BetterPort.BetterSerialPort({
            path: "/dev/serial/by-id/usb-CubePilot_CubeOrange+_260041000D51323039383833-if00",
            baudRate: 912600,
            keepOpen: true,
            autoOpen: true
        });
    }
    else if (mode == "udp") {
        //Listen to mavproxy on --out udp::6020
        var port = new BetterPort.BetterUDPPort({
            recPort: 6020
        });
    }

    port.on(BetterPortEvent.open, () => {
        console.log("Port opened");

        if (firstOpen == true) {
            firstOpen = false;
            var time = 0;
            setTimeout(() => {
                console.log("CLOSE THE PORT -- Expect re-open");
                port.closePort();
            }, time += 2000);

            setTimeout(() => {
                console.log("CLOSE THE PORT -- Expect not to reopen");
                port.closePort(true);
            }, time += 2000);

            setTimeout(() => {
                console.log("OPEN THE PORT again");
                port.openPort(true);
            }, time += 2000);

            setTimeout(() => {
                console.log("CLOSE THE PORT -- Expect re-open");
                port.closePort();
            }, time += 2000);

            setTimeout(() => {
                setInterval(async () => {
                    console.log("REBOOT");
                    const command = new NodeMavlink.common.CommandLong();
                    command.command = NodeMavlink.common.MavCmd.PREFLIGHT_REBOOT_SHUTDOWN;
                    command.confirmation = 0;
                    command._param1 = 1; //Autopilot reboot
                    command._param2 = 0;
                    command._param3 = 0;
                    command._param4 = 0;
                    command._param5 = 0;
                    command._param6 = 20190226;
                    command._param7 = 0;
                    try { await NodeMavlink.send(port, command, new NodeMavlink.MavLinkProtocolV2()); }
                    catch (e) {
                        console.log("Error sending command", e);
                    }
                }, 5000);
            }, time += 2000);
        }
    });
    port.on(BetterPortEvent.close, () => {
        console.log("Port closed");
    });
    port.on(BetterPortEvent.error, (err) => {
        console.log("Port error: ", err);
    });
    port.on(BetterPortEvent.data, (data) => {
        console.log("Port data");
    });

    port.openPort().then(() => {
        console.log("Port created");
    }).catch((err) => {
        console.log("Port open error", err);
    });
}
main();