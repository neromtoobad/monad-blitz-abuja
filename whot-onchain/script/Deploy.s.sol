// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {Whot} from "../src/Whot.sol";

contract Deploy is Script {
    function run() external returns (Whot whot) {
        vm.startBroadcast();
        whot = new Whot();
        vm.stopBroadcast();

        console.log("Whot deployed to:", address(whot));
        console.log("Explorer: https://testnet.monadexplorer.com/address/%s", address(whot));
    }
}
