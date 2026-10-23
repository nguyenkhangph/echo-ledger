// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {EchoLedger} from "../src/EchoLedger.sol";

contract DeployEchoLedger is Script {
    address internal constant SEPOLIA_MOCK_KEYSTONE_FORWARDER = 0x15fC6ae953E024d975e77382eEeC56A9101f9F88;

    function run() external returns (EchoLedger ledger) {
        address forwarder = vm.envOr("FORWARDER", SEPOLIA_MOCK_KEYSTONE_FORWARDER);

        vm.startBroadcast();
        ledger = new EchoLedger(forwarder);
        vm.stopBroadcast();
    }
}
