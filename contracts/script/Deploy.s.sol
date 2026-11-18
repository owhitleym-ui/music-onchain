// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {Competition} from "../src/Competition.sol";
import {SongRegistry} from "../src/SongRegistry.sol";
import {IERC20} from "../src/interfaces/IERC20.sol";

/// @notice Deploys SongRegistry + Competition.
/// Env:
///   DEPLOYER_PRIVATE_KEY  - test key only; becomes owner
///   ORACLE_ADDRESS        - address allowed to settle
///   TREASURY_ADDRESS      - receives platform share (defaults to deployer)
///   USDC_ADDRESS          - defaults to Arc testnet USDC ERC-20 interface
contract Deploy is Script {
    address constant ARC_TESTNET_USDC = 0x3600000000000000000000000000000000000000;

    function run() external returns (SongRegistry registry, Competition competition) {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address oracle = vm.envAddress("ORACLE_ADDRESS");
        address treasury = vm.envOr("TREASURY_ADDRESS", deployer);
        address usdc = vm.envOr("USDC_ADDRESS", ARC_TESTNET_USDC);

        vm.startBroadcast(pk);
        registry = new SongRegistry(deployer);
        competition = new Competition(IERC20(usdc), registry, deployer, oracle, treasury);
        vm.stopBroadcast();

        console.log("NEXT_PUBLIC_SONG_REGISTRY_ADDRESS=%s", address(registry));
        console.log("NEXT_PUBLIC_COMPETITION_ADDRESS=%s", address(competition));
    }
}
